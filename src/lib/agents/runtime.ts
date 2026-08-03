import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { providerCredentialHealthEvents } from "@/db/provider-health-schema";
import {
  agentMcpTools,
  agentVersions,
  agents,
  conversations,
  mcpServers,
  mcpTools,
  messages,
  modelCatalog,
  organizations,
  providerCredentials,
  runEvents,
  runs,
  toolApprovals,
} from "@/db/schema";
import { rankModels, type InputKind } from "@/server/models/router";
import { ApiError } from "@/lib/http/api";
import {
  isCredentialScopedProviderError,
  prioritizeProviderCandidates,
  providerCircuitOpenUntil,
  shouldFallbackProviderError,
} from "@/lib/providers/failure-policy";
import { ProviderError, type ProviderContentPart, type ProviderMessage, type ProviderUsage } from "@/lib/providers/types";
import { asProviderTypeId, asTransportMode, resolveProviderApiKey } from "@/lib/providers/provider-config";
import { runCloudflareRestChat, streamCloudflareRestChat } from "@/lib/providers/cloudflare-rest";
import { healthStatusForProviderError } from "@/lib/providers/errors";
import { runWorkersAiChat, streamWorkersAiChat } from "@/lib/providers/workers-ai";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";
import {
  AiSdkCandidateError,
  executeAiSdkCandidate,
  streamAiSdkCandidate,
  type AiSdkCandidate,
  type AiSdkExecutionResult,
  type AiSdkExecutionState,
} from "@/lib/ai-sdk/runtime";
import { appendRunEvent, appendRunEvents } from "@/lib/ai-sdk/run-events";
import { createRunStepAllocator, persistRunStep } from "@/lib/ai-sdk/run-steps";
import { deleteRunCheckpoints } from "@/lib/ai-sdk/checkpoints";

const activeControllers = new Map<string, AbortController>();
const MAX_CONTEXT_TOKENS_ESTIMATE = 24_000;
const MAX_CONTEXT_MESSAGES = 80;

type RunStatusFilter = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

function estimatedTokens(content: string) {
  return Math.ceil(content.length / 4) + 8;
}

function safeProviderError(error: unknown) {
  if (error instanceof AiSdkCandidateError) return error.providerError;
  if (error instanceof ProviderError) return error;
  return new ProviderError("RUN_FAILED", "تعذر إكمال تشغيل الوكيل.", 502);
}

function executionState(error: unknown): AiSdkExecutionState | undefined {
  return error instanceof AiSdkCandidateError ? error.executionState : undefined;
}

function mayFallback(error: ProviderError, state?: AiSdkExecutionState) {
  return shouldFallbackProviderError(error)
    && !state?.emittedText
    && !state?.toolExecuted
    && !state?.toolResultSaved
    && !state?.sideEffectOccurred
    && !state?.approvalPending;
}

type RuntimeCandidate = {
  credential: typeof providerCredentials.$inferSelect;
  model: string;
  capabilities: Record<string, boolean | undefined>;
};

function emptyExecutionState(): AiSdkExecutionState {
  return {
    emittedText: false,
    toolExecuted: false,
    toolResultSaved: false,
    sideEffectOccurred: false,
    approvalPending: false,
  };
}

function aiSdkCandidate(candidate: RuntimeCandidate, organizationId: string): AiSdkCandidate {
  const credential = candidate.credential;
  return {
    providerCredentialId: credential.id,
    provider: credential.provider,
    providerTypeId: asProviderTypeId(credential.providerTypeId, credential.provider),
    transportMode: asTransportMode(credential.transportMode),
    apiKey: resolveProviderApiKey(credential, organizationId),
    baseUrl: credential.baseUrl,
    model: candidate.model,
    capabilities: candidate.capabilities,
    gatewayId: credential.gatewayId ?? undefined,
    keyAlias: credential.keyAlias ?? undefined,
    skipCache: credential.gatewaySkipCache,
    cacheTtl: credential.gatewayCacheTtl ?? undefined,
    collectLog: credential.gatewayCollectLog,
  };
}

function adapterRuntimeInput(input: {
  organizationId: string;
  requestId: string;
  candidate: RuntimeCandidate;
  context: ProviderMessage[];
  temperature: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
}) {
  const credential = input.candidate.credential;
  return {
    model: input.candidate.model,
    providerKind: credential.provider,
    messages: input.context,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    gatewayId: credential.gatewayId ?? undefined,
    skipCache: credential.gatewaySkipCache,
    cacheTtl: credential.gatewayCacheTtl ?? undefined,
    collectLog: credential.gatewayCollectLog,
    requestId: input.requestId,
    signal: input.signal,
  };
}

async function executeRuntimeCandidate(input: Omit<Parameters<typeof executeAiSdkCandidate>[0], "candidate"> & { candidateRecord: RuntimeCandidate }): Promise<AiSdkExecutionResult> {
  const mode = asTransportMode(input.candidateRecord.credential.transportMode);
  if (mode === "direct" || mode === "cloudflare_ai_gateway_native") {
    return executeAiSdkCandidate({ ...input, candidate: aiSdkCandidate(input.candidateRecord, input.organizationId) });
  }
  const state = emptyExecutionState();
  try {
    const request = adapterRuntimeInput({
      organizationId: input.organizationId,
      requestId: input.requestId,
      candidate: input.candidateRecord,
      context: input.context ?? [],
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      signal: input.abortSignal,
    });
    const result = mode === "cloudflare_workers_ai"
      ? await runWorkersAiChat(request)
      : await runCloudflareRestChat(request);
    return {
      status: "completed",
      text: result.text,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      providerRequestId: "providerRequestId" in result ? result.providerRequestId : undefined,
      state,
    };
  } catch (error) {
    throw new AiSdkCandidateError(safeProviderError(error), state);
  }
}

async function* streamRuntimeCandidate(input: Omit<Parameters<typeof streamAiSdkCandidate>[0], "candidate"> & { candidateRecord: RuntimeCandidate }): AsyncGenerator<{ type: "delta"; text: string } | { type: "result"; result: AiSdkExecutionResult }> {
  const mode = asTransportMode(input.candidateRecord.credential.transportMode);
  if (mode === "direct" || mode === "cloudflare_ai_gateway_native") {
    yield* streamAiSdkCandidate({ ...input, candidate: aiSdkCandidate(input.candidateRecord, input.organizationId) });
    return;
  }
  const state = emptyExecutionState();
  let text = "";
  let usage: ProviderUsage = { inputTokens: null, outputTokens: null };
  let providerRequestId: string | undefined;
  try {
    const request = adapterRuntimeInput({
      organizationId: input.organizationId,
      requestId: input.requestId,
      candidate: input.candidateRecord,
      context: input.context,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      signal: input.abortSignal,
    });
    const source = mode === "cloudflare_workers_ai"
      ? streamWorkersAiChat(request)
      : streamCloudflareRestChat(request);
    for await (const chunk of source) {
      if (chunk.type === "delta") {
        state.emittedText = true;
        text += chunk.text;
        yield { type: "delta", text: chunk.text };
      } else if (chunk.type === "usage") {
        usage = chunk.usage;
        providerRequestId = chunk.providerRequestId ?? providerRequestId;
      } else {
        providerRequestId = chunk.providerRequestId ?? providerRequestId;
      }
    }
    yield {
      type: "result",
      result: { status: "completed", text, usage, providerRequestId, state },
    };
  } catch (error) {
    throw new AiSdkCandidateError(safeProviderError(error), state);
  }
}

function titleFromFirstMessage(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69).trimEnd()}…`;
}

async function contextMessages(
  conversationId: string,
  instructions: string,
  maxOutputTokens: number,
  media: ProviderContentPart[] = [],
) {
  const rows = await db().select({
    role: messages.role,
    content: messages.content,
  }).from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      eq(messages.status, "completed"),
      isNull(messages.deletedAt),
    ))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_CONTEXT_MESSAGES);

  const budget = Math.max(2_000, MAX_CONTEXT_TOKENS_ESTIMATE - maxOutputTokens);
  let used = estimatedTokens(instructions);
  const selected: typeof rows = [];
  for (const message of rows) {
    const tokens = estimatedTokens(message.content);
    if (selected.length > 0 && used + tokens > budget) break;
    used += tokens;
    selected.push(message);
  }
  selected.reverse();
  const history: ProviderMessage[] = selected.map((message) => ({ role: message.role, content: message.content }));
  if (media.length) {
    let latestUser = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index]?.role === "user") {
        latestUser = index;
        break;
      }
    }
    if (latestUser >= 0) {
      const current = history[latestUser]!;
      const text = typeof current.content === "string"
        ? current.content
        : current.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      history[latestUser] = {
        role: "user",
        content: [{ type: "text", text }, ...media],
      };
    }
  }
  return {
    messages: [{ role: "system", content: instructions }, ...history] satisfies ProviderMessage[],
    estimatedInputTokens: used,
  };
}

async function hasEnabledAgentTools(organizationId: string, agentId: string) {
  const [row] = await db().select({ value: count() }).from(agentMcpTools)
    .innerJoin(mcpTools, eq(mcpTools.id, agentMcpTools.toolId))
    .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.serverId))
    .where(and(
      eq(agentMcpTools.organizationId, organizationId),
      eq(agentMcpTools.agentId, agentId),
      eq(mcpTools.organizationId, organizationId),
      eq(mcpTools.enabled, true),
      eq(mcpServers.organizationId, organizationId),
      eq(mcpServers.enabled, true),
      eq(mcpServers.status, "connected"),
    ));
  return Number(row?.value ?? 0) > 0;
}

export async function prepareAgentRun(input: {
  organizationId: string;
  userId?: string;
  agentId: string;
  conversationId: string;
  message: string;
  requestId: string;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
  media?: ProviderContentPart[];
}) {
  const [agent] = await db().select().from(agents).where(and(
    eq(agents.id, input.agentId),
    eq(agents.organizationId, input.organizationId),
  )).limit(1);
  if (!agent || agent.status !== "published") {
    throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير موجود أو غير منشور.");
  }

  const [version] = await db().select().from(agentVersions)
    .where(and(eq(agentVersions.agentId, agent.id), eq(agentVersions.version, agent.currentVersion)))
    .limit(1);
  if (!version) throw new ApiError(409, "AGENT_VERSION_MISSING", "الإصدار المنشور للوكيل غير متاح.");

  const [organization, catalog, credentials, toolsEnabled] = await Promise.all([
    db().select({
      defaultProviderCredentialId: organizations.defaultProviderCredentialId,
      defaultModel: organizations.defaultModel,
    }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1),
    db().select().from(modelCatalog).where(and(
      eq(modelCatalog.organizationId, input.organizationId),
      eq(modelCatalog.available, true),
    )),
    db().select().from(providerCredentials).where(and(
      eq(providerCredentials.organizationId, input.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
    )),
    hasEnabledAgentTools(input.organizationId, input.agentId),
  ]);
  const now = new Date();
  const usableCredentials = credentials.filter((credential) =>
    !credential.circuitOpenUntil || credential.circuitOpenUntil <= now);
  const credentialById = new Map(usableCredentials.map((credential) => [credential.id, credential]));
  const catalogByModel = new Map(catalog.map((entry) => [
    `${entry.providerCredentialId}:${entry.model}`,
    entry,
  ]));
  const routable = usableCredentials.flatMap((credential) => credential.discoveredModels.map((model) => {
    const catalogEntry = catalogByModel.get(`${credential.id}:${model}`);
    return {
      providerCredentialId: credential.id,
      model,
      available: catalogEntry?.available ?? true,
      freeTierEligible: catalogEntry?.freeTierEligible ?? isFreeTierModel(model),
      latencyMs: catalogEntry?.latencyMs ?? credential.lastValidationLatencyMs,
      capabilities: {
        ...inferModelCapabilities(credential.provider, model),
        ...(catalogEntry?.capabilities ?? {}),
      },
      isAgentDefault: credential.id === (agent.defaultProviderCredentialId ?? version.providerCredentialId)
        && model === (agent.defaultModel ?? version.model),
      isOrganizationDefault: credential.id === organization[0]?.defaultProviderCredentialId
        && model === organization[0]?.defaultModel,
    };
  }));

  const inputKind = input.inputKind ?? "text";
  const ranked = rankModels(routable, inputKind).filter((candidate) => {
    if (!toolsEnabled) return true;
    const credential = credentialById.get(candidate.providerCredentialId);
    if (!credential) return false;
    const mode = asTransportMode(credential.transportMode);
    if (mode === "cloudflare_ai_gateway_rest" || mode === "cloudflare_workers_ai") return false;
    return candidate.capabilities.tools === true || candidate.capabilities.toolCalling === true;
  });
  const preferredCredentialId = input.providerCredentialId
    ?? agent.defaultProviderCredentialId
    ?? version.providerCredentialId;
  const preferredModel = input.model ?? agent.defaultModel ?? version.model;
  const explicitSelection = Boolean(input.providerCredentialId || input.model);
  const prioritized = prioritizeProviderCandidates(
    ranked,
    (candidate) => explicitSelection
      ? (!input.providerCredentialId || candidate.providerCredentialId === input.providerCredentialId)
        && (!input.model || candidate.model === input.model)
      : candidate.providerCredentialId === preferredCredentialId && candidate.model === preferredModel,
  );

  if (prioritized.length === 0) {
    if (toolsEnabled) {
      throw new ApiError(422, "TOOL_CALLING_MODEL_REQUIRED", "الوكيل مرتبط بأدوات ولا يوجد نموذج متحقق يدعم Tool Calling.");
    }
    if (inputKind === "image") {
      throw new ApiError(422, "VISION_MODEL_REQUIRED", "لا يوجد نموذج مفعّل يدعم تحليل الصور. اربط نموذج Vision ثم أعد المحاولة.");
    }
    if (inputKind === "audio" || inputKind === "video") {
      throw new ApiError(422, "MEDIA_MODEL_REQUIRED", "لا يوجد نموذج مفعّل يدعم هذا النوع من الوسائط.");
    }
    throw new ApiError(422, "PROVIDER_OR_MODEL_UNAVAILABLE", "لا يوجد مزود متحقق ونموذج مناسب لتشغيل الوكيل.");
  }
  const candidates = prioritized.flatMap((candidate) => {
    const credential = credentialById.get(candidate.providerCredentialId);
    return credential ? [{ credential, model: candidate.model, capabilities: candidate.capabilities }] : [];
  });
  const primary = candidates[0];
  if (!primary) throw new ApiError(422, "PROVIDER_UNAVAILABLE", "المزود معطل أو لم يجتز آخر فحص.");

  const [conversation] = await db().select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
      eq(conversations.agentId, agent.id),
      input.userId ? eq(conversations.createdByUserId, input.userId) : undefined,
      isNull(conversations.archivedAt),
      isNull(conversations.deletedAt),
    ))
    .limit(1);
  if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو مؤرشفة.");

  const context = await contextMessages(conversation.id, version.instructions, version.maxOutputTokens, input.media);
  const [run] = await db().transaction(async (tx) => {
    const [created] = await tx.insert(runs).values({
      organizationId: input.organizationId,
      agentId: agent.id,
      agentVersionId: version.id,
      conversationId: conversation.id,
      status: "queued",
      requestId: input.requestId,
      input: input.message,
      provider: primary.credential.provider,
      model: primary.model,
    }).returning();
    if (!created) throw new Error("RUN_CREATE_FAILED");
    await tx.insert(runEvents).values({
      runId: created.id,
      sequence: 1,
      type: "run.created",
      payload: {
        agentId: agent.id,
        version: version.version,
        requestId: input.requestId,
        requestedProviderCredentialId: input.providerCredentialId ?? null,
        requestedModel: input.model ?? null,
        toolsEnabled,
      },
    });
    return [created];
  });

  return {
    run,
    candidates,
    version: { ...version, model: primary.model },
    context: context.messages,
    estimatedInputTokens: context.estimatedInputTokens,
    requestedProviderCredentialId: input.providerCredentialId ?? null,
    requestedModel: input.model ?? null,
  };
}

async function beginProviderRequest(organizationId: string, runId: string) {
  await db().update(runs).set({ status: "running", startedAt: new Date() }).where(and(
    eq(runs.id, runId),
    eq(runs.organizationId, organizationId),
  ));
  await appendRunEvents({
    organizationId,
    runId,
    events: [
      { type: "run.running" },
      { type: "provider.request.started" },
    ],
  });
}

async function recordCredentialFailure(input: {
  organizationId: string;
  runId: string;
  providerCredentialId: string;
  model: string;
  error: ProviderError;
}) {
  try {
    await db().transaction(async (tx) => {
      const [credential] = await tx.select({
        failures: providerCredentials.consecutiveFailures,
      }).from(providerCredentials).where(and(
        eq(providerCredentials.id, input.providerCredentialId),
        eq(providerCredentials.organizationId, input.organizationId),
      )).limit(1);
      if (!credential) return;
      const failures = credential.failures + 1;
      const circuitOpenUntil = providerCircuitOpenUntil(input.error, failures);
      const invalidCredential = input.error.code === "PROVIDER_UNAUTHORIZED"
        || input.error.code === "PROVIDER_FORBIDDEN";
      const failedAt = new Date();
      await tx.update(providerCredentials).set({
        consecutiveFailures: failures,
        lastErrorCode: input.error.code,
        lastErrorCategory: input.error.category,
        lastCheckedAt: failedAt,
        lastFailureAt: failedAt,
        healthStatus: healthStatusForProviderError(input.error),
        circuitOpenUntil,
        ...(invalidCredential ? { validationStatus: "failed" as const } : {}),
        updatedAt: failedAt,
      }).where(and(
        eq(providerCredentials.id, input.providerCredentialId),
        eq(providerCredentials.organizationId, input.organizationId),
      ));
      if (input.error.code === "PROVIDER_ENDPOINT_NOT_FOUND") {
        await tx.update(modelCatalog).set({ available: false, updatedAt: new Date() }).where(and(
          eq(modelCatalog.organizationId, input.organizationId),
          eq(modelCatalog.providerCredentialId, input.providerCredentialId),
          eq(modelCatalog.model, input.model),
        ));
      }
      await tx.insert(providerCredentialHealthEvents).values({
        organizationId: input.organizationId,
        providerCredentialId: input.providerCredentialId,
        runId: input.runId,
        outcome: "failed",
        model: input.model,
        errorCode: input.error.code,
        errorCategory: input.error.category,
        requestId: input.error.requestId,
        providerRequestId: input.error.providerRequestId,
        providerStatus: input.error.providerStatus,
        retryable: input.error.retryable,
        circuitOpenUntil,
      });
    });
  } catch (healthError) {
    console.error(JSON.stringify(safeTelemetry({
      operation: "provider.health.record_failure",
      runId: input.runId,
      providerCredentialId: input.providerCredentialId,
      status: "error",
      errorCode: healthError instanceof Error ? healthError.name : "UNKNOWN",
    })));
  }
}

export async function completeAgentRun(input: {
  organizationId: string;
  runId: string;
  conversationId: string;
  providerCredentialId: string;
  text: string;
  usage: ProviderUsage;
  providerRequestId?: string;
  model: string;
  attemptCount: number;
  requestedProviderCredentialId: string | null;
  requestedModel: string | null;
}) {
  const completedAt = new Date();
  const fallbackUsed = input.attemptCount > 1
    || Boolean(input.requestedProviderCredentialId && input.requestedProviderCredentialId !== input.providerCredentialId)
    || Boolean(input.requestedModel && input.requestedModel !== input.model);
  console.info(JSON.stringify(safeTelemetry({
    operation: "agent.run",
    runId: input.runId,
    providerCredentialId: input.providerCredentialId,
    model: input.model,
    status: "ok",
  })));
  const result = await db().transaction(async (tx) => {
    const [runRecord] = await tx.select({
      id: runs.id,
      requestId: runs.requestId,
      startedAt: runs.startedAt,
    }).from(runs).where(and(
      eq(runs.id, input.runId),
      eq(runs.organizationId, input.organizationId),
    )).limit(1);
    if (!runRecord) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
    const latencyMs = runRecord.startedAt
      ? Math.max(0, completedAt.getTime() - runRecord.startedAt.getTime())
      : null;
    const routing = {
      attemptCount: input.attemptCount,
      fallbackUsed,
      requestedProviderCredentialId: input.requestedProviderCredentialId,
      requestedModel: input.requestedModel,
      providerCredentialId: input.providerCredentialId,
      model: input.model,
    };
    const assistantValues = {
      content: input.text,
      contentParts: [{ type: "text", text: input.text }],
      status: "completed" as const,
      requestId: runRecord.requestId,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      latencyMs,
      errorCode: null,
      completedAt,
      providerCredentialId: input.providerCredentialId,
      model: input.model,
      metadata: { runId: input.runId, model: input.model, routing },
    };
    const [existingAssistant] = await tx.select({ id: messages.id }).from(messages).where(and(
      eq(messages.conversationId, input.conversationId),
      eq(messages.clientRequestId, input.runId),
      eq(messages.role, "assistant"),
      isNull(messages.deletedAt),
    )).limit(1);
    const [assistantMessage] = existingAssistant
      ? await tx.update(messages).set(assistantValues).where(eq(messages.id, existingAssistant.id)).returning()
      : await tx.insert(messages).values({
          conversationId: input.conversationId,
          role: "assistant",
          clientRequestId: input.runId,
          ...assistantValues,
        }).returning();
    const [completed] = await tx.update(runs).set({
      status: "completed",
      output: input.text,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      providerRequestId: input.providerRequestId,
      error: null,
      errorCode: null,
      completedAt,
    }).where(and(eq(runs.id, input.runId), eq(runs.organizationId, input.organizationId))).returning();

    const [conversation] = await tx.select({ title: conversations.title }).from(conversations).where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
    )).limit(1);
    let generatedTitle: string | null = null;
    if (!conversation?.title || conversation.title.startsWith("محادثة مع ")) {
      const [firstUserMessage] = await tx.select({ content: messages.content }).from(messages).where(and(
        eq(messages.conversationId, input.conversationId),
        eq(messages.role, "user"),
        isNull(messages.deletedAt),
      )).orderBy(asc(messages.createdAt)).limit(1);
      generatedTitle = firstUserMessage ? titleFromFirstMessage(firstUserMessage.content) : null;
    }
    await tx.update(conversations).set({
      ...(generatedTitle ? { title: generatedTitle } : {}),
      status: "active",
      providerCredentialId: input.providerCredentialId,
      model: input.model,
      lastMessageAt: completedAt,
      updatedAt: completedAt,
    }).where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
    ));
    await tx.update(providerCredentials).set({
      validationStatus: "verified",
      healthStatus: "healthy",
      consecutiveFailures: 0,
      lastCheckedAt: completedAt,
      lastSuccessfulAt: completedAt,
      lastErrorCode: null,
      lastErrorCategory: null,
      circuitOpenUntil: null,
      updatedAt: completedAt,
    }).where(and(
      eq(providerCredentials.id, input.providerCredentialId),
      eq(providerCredentials.organizationId, input.organizationId),
    ));
    await tx.update(modelCatalog).set({
      available: true,
      lastSeenAt: completedAt,
      updatedAt: completedAt,
    }).where(and(
      eq(modelCatalog.organizationId, input.organizationId),
      eq(modelCatalog.providerCredentialId, input.providerCredentialId),
      eq(modelCatalog.model, input.model),
    ));
    await tx.insert(providerCredentialHealthEvents).values({
      organizationId: input.organizationId,
      providerCredentialId: input.providerCredentialId,
      runId: input.runId,
      outcome: "completed",
      model: input.model,
      requestId: runRecord.requestId,
      providerRequestId: input.providerRequestId,
      latencyMs,
      retryable: false,
    });
    return { run: completed, assistantMessage };
  });
  await appendRunEvents({
    organizationId: input.organizationId,
    runId: input.runId,
    events: [
      {
        type: "provider.request.completed",
        payload: {
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          providerRequestId: input.providerRequestId,
          fallbackUsed,
        },
      },
      { type: "run.completed", payload: { fallbackUsed, userNotified: fallbackUsed } },
    ],
  });
  await deleteRunCheckpoints(input.organizationId, input.runId);
  return result;
}

async function ensureStreamingAssistantMessage(input: {
  conversationId: string;
  runId: string;
  requestId: string;
  providerCredentialId: string;
  model: string;
}) {
  await db().insert(messages).values({
    conversationId: input.conversationId,
    role: "assistant",
    content: "",
    contentParts: [],
    status: "streaming",
    requestId: input.requestId,
    clientRequestId: input.runId,
    providerCredentialId: input.providerCredentialId,
    model: input.model,
    metadata: { runId: input.runId, streaming: true },
  }).onConflictDoNothing();
}

async function persistStreamingAssistantProgress(input: {
  conversationId: string;
  runId: string;
  text: string;
  status?: "streaming" | "interrupted";
  errorCode?: string | null;
}) {
  await db().update(messages).set({
    content: input.text,
    contentParts: input.text ? [{ type: "text", text: input.text }] : [],
    status: input.status ?? "streaming",
    errorCode: input.errorCode ?? null,
    ...(input.status === "interrupted" ? { completedAt: new Date() } : {}),
  }).where(and(
    eq(messages.conversationId, input.conversationId),
    eq(messages.clientRequestId, input.runId),
    eq(messages.role, "assistant"),
    isNull(messages.deletedAt),
  ));
}

export async function failAgentRun(
  organizationId: string,
  runId: string,
  error: ProviderError,
  execution?: AiSdkExecutionState,
  partialText = "",
) {
  const errorCode = execution?.sideEffectOccurred || execution?.toolResultSaved
    ? "PROVIDER_FAILURE_AFTER_SIDE_EFFECT"
    : error.code;
  const message = errorCode === "PROVIDER_FAILURE_AFTER_SIDE_EFFECT"
    ? "فشل المزود بعد تنفيذ أداة أو تغيير حالة خارجية؛ أوقف التشغيل للمراجعة ولم تتم إعادة التنفيذ تلقائيًا."
    : error.message;
  const completedAt = new Date();
  const messageStatus = error.code === "PROVIDER_CANCELLED"
    ? "cancelled" as const
    : partialText.trim() ? "interrupted" as const : "failed" as const;
  console.error(JSON.stringify(safeTelemetry({ operation: "agent.run", runId, status: "error", errorCode })));
  await db().transaction(async (tx) => {
    const [run] = await tx.select({
      id: runs.id,
      conversationId: runs.conversationId,
      requestId: runs.requestId,
      model: runs.model,
    }).from(runs).where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId))).limit(1);
    if (!run) return;
    await tx.update(runs).set({
      status: error.code === "PROVIDER_CANCELLED" ? "cancelled" : "failed",
      error: message,
      errorCode,
      completedAt,
    }).where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)));
    if (run.conversationId) {
      const assistantValues = {
        content: partialText,
        contentParts: partialText ? [{ type: "text", text: partialText }] : [],
        status: messageStatus,
        requestId: run.requestId,
        errorCode,
        completedAt,
        model: run.model,
        metadata: {
          runId,
          diagnostic: {
            category: error.category,
            code: errorCode,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            requestId: error.requestId,
            providerRequestId: error.providerRequestId,
            timestamp: error.timestamp,
          },
          incomplete: true,
        },
      };
      const [existing] = await tx.select({ id: messages.id }).from(messages).where(and(
        eq(messages.conversationId, run.conversationId),
        eq(messages.clientRequestId, runId),
        eq(messages.role, "assistant"),
        isNull(messages.deletedAt),
      )).limit(1);
      if (existing) {
        await tx.update(messages).set(assistantValues).where(eq(messages.id, existing.id));
      } else {
        await tx.insert(messages).values({
          conversationId: run.conversationId,
          role: "assistant",
          clientRequestId: runId,
          ...assistantValues,
        });
      }
      await tx.update(conversations).set({
        lastMessageAt: completedAt,
        updatedAt: completedAt,
      }).where(and(
        eq(conversations.id, run.conversationId),
        eq(conversations.organizationId, organizationId),
      ));
    }
  });
  await appendRunEvents({
    organizationId,
    runId,
    events: [
      {
        type: error.code === "PROVIDER_CANCELLED" ? "run.cancelled" : "provider.request.failed",
        payload: {
          code: errorCode,
          category: error.category,
          providerStatus: error.providerStatus,
          providerRequestId: error.providerRequestId,
          partialOutputSaved: Boolean(partialText),
        },
      },
      ...(error.code === "PROVIDER_CANCELLED" ? [] : [{ type: "run.failed", payload: { code: errorCode } }]),
    ],
  });
  await deleteRunCheckpoints(organizationId, runId);
}

async function waitingResult(organizationId: string, runId: string, approvalId?: string) {
  const [run] = await db().select().from(runs).where(and(
    eq(runs.id, runId),
    eq(runs.organizationId, organizationId),
  )).limit(1);
  return { run, assistantMessage: null, approvalId };
}

export async function executeAgentRun(input: {
  organizationId: string;
  userId?: string;
  agentId: string;
  message: string;
  conversationId: string;
  requestId?: string;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
  media?: ProviderContentPart[];
}) {
  const requestId = input.requestId ?? crypto.randomUUID();
  const prepared = await prepareAgentRun({ ...input, requestId });
  await beginProviderRequest(input.organizationId, prepared.run.id);
  const controller = new AbortController();
  activeControllers.set(prepared.run.id, controller);
  const allocateStep = await createRunStepAllocator(input.organizationId, prepared.run.id);
  try {
    let lastError: ProviderError | undefined;
    let lastState: AiSdkExecutionState | undefined;
    let attemptCount = 0;
    const blockedCredentialIds = new Set<string>();
    for (const [candidateIndex, candidate] of prepared.candidates.entries()) {
      if (blockedCredentialIds.has(candidate.credential.id)) continue;
      attemptCount += 1;
      await appendRunEvent({
        organizationId: input.organizationId,
        runId: prepared.run.id,
        type: "provider.attempt.started",
        payload: { attempt: attemptCount, provider: candidate.credential.provider, model: candidate.model },
      });
      if (attemptCount > 1) {
        await db().update(runs).set({
          provider: candidate.credential.provider,
          model: candidate.model,
        }).where(and(eq(runs.id, prepared.run.id), eq(runs.organizationId, input.organizationId)));
      }
      try {
        const result = await executeRuntimeCandidate({
          organizationId: input.organizationId,
          userId: input.userId,
          agentId: input.agentId,
          runId: prepared.run.id,
          conversationId: input.conversationId,
          requestId,
          candidateIndex,
          candidateRecord: candidate,
          context: prepared.context,
          temperature: prepared.version.temperatureMilli / 1000,
          maxOutputTokens: prepared.version.maxOutputTokens,
          abortSignal: controller.signal,
          allocateStep,
        });
        await appendRunEvent({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          type: "provider.attempt.completed",
          payload: { attempt: attemptCount, status: result.status, model: candidate.model },
        });
        if (result.status === "waiting_approval") {
          await db().update(runs).set({
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            providerRequestId: result.providerRequestId,
          }).where(and(eq(runs.id, prepared.run.id), eq(runs.organizationId, input.organizationId)));
          return waitingResult(input.organizationId, prepared.run.id, result.approvalId);
        }
        if (!result.text.trim()) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
        return completeAgentRun({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          conversationId: input.conversationId,
          providerCredentialId: candidate.credential.id,
          text: result.text,
          usage: result.usage,
          providerRequestId: result.providerRequestId,
          model: candidate.model,
          attemptCount,
          requestedProviderCredentialId: prepared.requestedProviderCredentialId,
          requestedModel: prepared.requestedModel,
        });
      } catch (error) {
        const safe = safeProviderError(error);
        const state = executionState(error);
        lastError = safe;
        lastState = state;
        await recordCredentialFailure({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          providerCredentialId: candidate.credential.id,
          model: candidate.model,
          error: safe,
        });
        if (isCredentialScopedProviderError(safe)) blockedCredentialIds.add(candidate.credential.id);
        if (!mayFallback(safe, state)) {
          await appendRunEvent({
            organizationId: input.organizationId,
            runId: prepared.run.id,
            type: "provider.fallback.blocked",
            payload: {
              code: safe.code,
              emittedText: state?.emittedText ?? false,
              toolExecuted: state?.toolExecuted ?? false,
              toolResultSaved: state?.toolResultSaved ?? false,
              sideEffectOccurred: state?.sideEffectOccurred ?? false,
              approvalPending: state?.approvalPending ?? false,
            },
          });
          break;
        }
        await persistRunStep({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          stepNumber: allocateStep(),
          stepType: "fallback",
          status: "completed",
          model: candidate.model,
          providerCredentialId: candidate.credential.id,
          errorCode: safe.code,
          metadata: { attempt: attemptCount },
        });
        await appendRunEvent({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          type: "provider.fallback.started",
          payload: {
            attempt: attemptCount + 1,
            previousErrorCode: safe.code,
            previousProviderCredentialId: candidate.credential.id,
            previousModel: candidate.model,
            nextProviderCredentialId: prepared.candidates[candidateIndex + 1]?.credential.id ?? null,
            nextModel: prepared.candidates[candidateIndex + 1]?.model ?? null,
            userNotified: false,
          },
        });
      }
    }
    const safe = lastError ?? new ProviderError("RUN_FAILED", "تعذر إكمال تشغيل الوكيل.", 502);
    await failAgentRun(input.organizationId, prepared.run.id, safe, lastState);
    throw new ApiError(safe.httpStatus, safe.code, safe.message, {
      runId: prepared.run.id,
      providerStatus: safe.providerStatus,
    });
  } finally {
    activeControllers.delete(prepared.run.id);
  }
}

export async function* streamAgentRun(input: {
  organizationId: string;
  userId?: string;
  agentId: string;
  message: string;
  conversationId: string;
  requestId: string;
  requestSignal?: AbortSignal;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
  media?: ProviderContentPart[];
}) {
  const prepared = await prepareAgentRun(input);
  await beginProviderRequest(input.organizationId, prepared.run.id);
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(input.requestSignal?.reason);
  input.requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  activeControllers.set(prepared.run.id, controller);
  const allocateStep = await createRunStepAllocator(input.organizationId, prepared.run.id);
  yield { type: "run" as const, runId: prepared.run.id };
  let accumulatedText = "";
  let streamingMessageCreated = false;
  let activeCandidate = prepared.candidates[0]!;
  let attemptCount = 0;
  let lastError: ProviderError | undefined;
  let lastState: AiSdkExecutionState | undefined;
  const blockedCredentialIds = new Set<string>();
  try {
    for (const [candidateIndex, candidate] of prepared.candidates.entries()) {
      if (blockedCredentialIds.has(candidate.credential.id)) continue;
      activeCandidate = candidate;
      attemptCount += 1;
      if (attemptCount > 1) {
        await db().update(runs).set({
          provider: candidate.credential.provider,
          model: candidate.model,
        }).where(and(eq(runs.id, prepared.run.id), eq(runs.organizationId, input.organizationId)));
      }
      try {
        let candidateResult: Awaited<ReturnType<typeof executeAiSdkCandidate>> | undefined;
        for await (const event of streamRuntimeCandidate({
          organizationId: input.organizationId,
          userId: input.userId,
          agentId: input.agentId,
          runId: prepared.run.id,
          conversationId: input.conversationId,
          requestId: input.requestId,
          candidateIndex,
          candidateRecord: candidate,
          context: prepared.context,
          temperature: prepared.version.temperatureMilli / 1000,
          maxOutputTokens: prepared.version.maxOutputTokens,
          abortSignal: controller.signal,
          allocateStep,
        })) {
          if (event.type === "delta") {
            if (!streamingMessageCreated) {
              await ensureStreamingAssistantMessage({
                conversationId: input.conversationId,
                runId: prepared.run.id,
                requestId: input.requestId,
                providerCredentialId: candidate.credential.id,
                model: candidate.model,
              });
              streamingMessageCreated = true;
            }
            accumulatedText += event.text;
            yield { type: "delta" as const, text: event.text };
          } else {
            candidateResult = event.result;
          }
        }
        if (!candidateResult) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نتيجة.", 502);
        if (candidateResult.status === "waiting_approval") {
          if (streamingMessageCreated) {
            await persistStreamingAssistantProgress({
              conversationId: input.conversationId,
              runId: prepared.run.id,
              text: accumulatedText,
            });
          }
          yield {
            type: "approval" as const,
            runId: prepared.run.id,
            approvalId: candidateResult.approvalId,
            status: "waiting_approval" as const,
          };
          return;
        }
        if (!candidateResult.text.trim()) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
        const completed = await completeAgentRun({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          conversationId: input.conversationId,
          providerCredentialId: candidate.credential.id,
          text: candidateResult.text,
          usage: candidateResult.usage,
          providerRequestId: candidateResult.providerRequestId,
          model: candidate.model,
          attemptCount,
          requestedProviderCredentialId: prepared.requestedProviderCredentialId,
          requestedModel: prepared.requestedModel,
        });
        yield {
          type: "complete" as const,
          runId: prepared.run.id,
          messageId: completed.assistantMessage?.id,
          usage: candidateResult.usage,
          model: candidate.model,
          fallbackUsed: attemptCount > 1,
        };
        return;
      } catch (error) {
        const safe = safeProviderError(error);
        const state = executionState(error);
        lastError = safe;
        lastState = state;
        await recordCredentialFailure({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          providerCredentialId: candidate.credential.id,
          model: candidate.model,
          error: safe,
        });
        if (isCredentialScopedProviderError(safe)) blockedCredentialIds.add(candidate.credential.id);
        if (accumulatedText.length > 0 || !mayFallback(safe, state)) break;
        await appendRunEvent({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          type: "provider.fallback.started",
          payload: {
            attempt: attemptCount + 1,
            previousErrorCode: safe.code,
            previousProviderCredentialId: candidate.credential.id,
            previousModel: candidate.model,
            nextProviderCredentialId: prepared.candidates[candidateIndex + 1]?.credential.id ?? null,
            nextModel: prepared.candidates[candidateIndex + 1]?.model ?? null,
            userNotified: false,
          },
        });
      }
    }
    const safe = lastError ?? new ProviderError("RUN_FAILED", "تعذر إكمال تشغيل الوكيل.", 502);
    await failAgentRun(input.organizationId, prepared.run.id, safe, lastState, accumulatedText);
    throw new ApiError(safe.httpStatus, safe.code, safe.message, {
      runId: prepared.run.id,
      providerStatus: safe.providerStatus,
      model: activeCandidate.model,
    });
  } finally {
    activeControllers.delete(prepared.run.id);
    input.requestSignal?.removeEventListener("abort", abortFromRequest);
  }
}

export async function cancelAgentRun(organizationId: string, runId: string) {
  const [run] = await db().select({ id: runs.id, status: runs.status, conversationId: runs.conversationId })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)))
    .limit(1);
  if (!run) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
  if (!["queued", "running", "waiting_approval"].includes(run.status)) {
    return { cancelled: false, status: run.status };
  }
  activeControllers.get(runId)?.abort();
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(runs).set({
      cancelRequestedAt: now,
      ...(run.status === "waiting_approval" ? { status: "cancelled" as const, completedAt: now } : {}),
    }).where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)));
    if (run.status === "waiting_approval") {
      if (run.conversationId) {
        await tx.update(messages).set({ status: "cancelled", errorCode: "PROVIDER_CANCELLED", completedAt: now }).where(and(
          eq(messages.conversationId, run.conversationId),
          eq(messages.clientRequestId, runId),
          eq(messages.role, "assistant"),
          isNull(messages.deletedAt),
        ));
      }
      await tx.update(toolApprovals).set({ status: "expired", decidedAt: now })
        .where(and(eq(toolApprovals.organizationId, organizationId), eq(toolApprovals.runId, runId), eq(toolApprovals.status, "pending")));
    }
  });
  if (run.status === "waiting_approval") await deleteRunCheckpoints(organizationId, runId);
  return { cancelled: true, status: run.status === "waiting_approval" ? "cancelled" : "cancelling" };
}

export async function listOrganizationRuns(input: {
  organizationId: string;
  userId?: string;
  page: number;
  limit: number;
  status?: RunStatusFilter;
}) {
  const where = and(
    eq(runs.organizationId, input.organizationId),
    input.status ? eq(runs.status, input.status) : undefined,
    input.userId ? eq(conversations.createdByUserId, input.userId) : undefined,
  );
  const [rows, totalRows] = await Promise.all([
    db().select({
      id: runs.id,
      agentId: runs.agentId,
      agentName: agents.name,
      status: runs.status,
      requestId: runs.requestId,
      provider: runs.provider,
      model: runs.model,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      providerRequestId: runs.providerRequestId,
      error: runs.error,
      errorCode: runs.errorCode,
      conversationId: runs.conversationId,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
      createdAt: runs.createdAt,
    }).from(runs)
      .innerJoin(agents, eq(agents.id, runs.agentId))
      .innerJoin(conversations, eq(conversations.id, runs.conversationId))
      .where(where)
      .orderBy(desc(runs.createdAt))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db().select({ value: count() }).from(runs)
      .innerJoin(conversations, eq(conversations.id, runs.conversationId))
      .where(where),
  ]);
  return { rows, total: totalRows[0]?.value ?? 0 };
}

export async function getRunEvents(organizationId: string, runId: string) {
  const [owned] = await db().select({ id: runs.id }).from(runs)
    .where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)))
    .limit(1);
  if (!owned) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
  return db().select({
    id: runEvents.id,
    sequence: runEvents.sequence,
    type: runEvents.type,
    payload: runEvents.payload,
    createdAt: runEvents.createdAt,
  }).from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.sequence));
}
