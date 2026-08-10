import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { providerCredentialHealthEvents } from "@/db/provider-health-schema";
import { databaseRows } from "@/db/result";
import { withDatabaseQuerySubsystem } from "@/db/query-observability";
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
import { healthStatusForProviderError } from "@/lib/providers/errors";
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
import { persistRunStep } from "@/lib/ai-sdk/run-steps";
import { deleteRunCheckpoints } from "@/lib/ai-sdk/checkpoints";
import { conversationAccessFilter } from "@/lib/chat/access";
import type { Role } from "@/lib/auth/permissions";

const activeControllers = new Map<string, AbortController>();
let activeProviderRequests = 0;
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

function freshRunStepAllocator() {
  let next = 1;
  return () => next++;
}
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
    requestId: input.requestId,
    signal: input.signal,
  };
}

async function executeRuntimeCandidate(input: Omit<Parameters<typeof executeAiSdkCandidate>[0], "candidate"> & { candidateRecord: RuntimeCandidate }): Promise<AiSdkExecutionResult> {
  asTransportMode(input.candidateRecord.credential.transportMode);
  const acquiredAt = performance.now();
  activeProviderRequests += 1;
  console.info(JSON.stringify(safeTelemetry({
    event: "ai.provider_request.acquired",
    runId: input.runId,
    activeProviderRequests,
    queuedProviderRequests: 0,
    requestSlotAcquireMs: 0,
    requestSlotOwner: `run:${input.runId}:provider:${input.candidateRecord.credential.id}`,
  })));
  try {
    return await executeAiSdkCandidate({ ...input, candidate: aiSdkCandidate(input.candidateRecord, input.organizationId) });
  } finally {
    activeProviderRequests = Math.max(0, activeProviderRequests - 1);
    console.info(JSON.stringify(safeTelemetry({
      event: "ai.provider_request.released",
      runId: input.runId,
      activeProviderRequests,
      queuedProviderRequests: 0,
      requestSlotHoldMs: Math.round(performance.now() - acquiredAt),
      requestSlotOwner: `run:${input.runId}:provider:${input.candidateRecord.credential.id}`,
    })));
  }
}

async function* streamRuntimeCandidate(input: Omit<Parameters<typeof streamAiSdkCandidate>[0], "candidate"> & { candidateRecord: RuntimeCandidate }): AsyncGenerator<{ type: "delta"; text: string } | { type: "result"; result: AiSdkExecutionResult }> {
  asTransportMode(input.candidateRecord.credential.transportMode);
  const acquiredAt = performance.now();
  activeProviderRequests += 1;
  console.info(JSON.stringify(safeTelemetry({
    event: "ai.provider_request.acquired",
    runId: input.runId,
    activeProviderRequests,
    queuedProviderRequests: 0,
    requestSlotAcquireMs: 0,
    requestSlotOwner: `run:${input.runId}:provider:${input.candidateRecord.credential.id}`,
  })));
  try {
    yield* streamAiSdkCandidate({ ...input, candidate: aiSdkCandidate(input.candidateRecord, input.organizationId) });
  } finally {
    activeProviderRequests = Math.max(0, activeProviderRequests - 1);
    console.info(JSON.stringify(safeTelemetry({
      event: "ai.provider_request.released",
      runId: input.runId,
      activeProviderRequests,
      queuedProviderRequests: 0,
      requestSlotHoldMs: Math.round(performance.now() - acquiredAt),
      requestSlotOwner: `run:${input.runId}:provider:${input.candidateRecord.credential.id}`,
    })));
  }
}

export function titleFromFirstMessage(value: string) {
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

async function hasEnabledAgentTools(
  organizationId: string,
  agentId: string,
  allowedToolIds?: readonly string[] | null,
) {
  const allowMcp = !(allowedToolIds && allowedToolIds.length === 0);
  const result = await withDatabaseQuerySubsystem("agent", () => db().execute(sql`
    SELECT (
      ${allowMcp ? sql`EXISTS (
        SELECT 1
        FROM agent_mcp_tools amt
        INNER JOIN mcp_tools mt ON mt.id = amt.tool_id
        INNER JOIN mcp_servers ms ON ms.id = mt.server_id
        WHERE amt.organization_id = ${organizationId}
          AND amt.agent_id = ${agentId}
          ${allowedToolIds?.length ? sql`AND amt.tool_id IN (${sql.join(allowedToolIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
          AND mt.organization_id = ${organizationId}
          AND mt.enabled = true
          AND ms.organization_id = ${organizationId}
          AND ms.enabled = true
          AND ms.status = 'connected'
      ) OR` : sql``}
      EXISTS (
        SELECT 1
        FROM agent_tool_bindings atb
        WHERE atb.organization_id = ${organizationId}
          AND atb.agent_id = ${agentId}
          AND atb.enabled = true
      )
    ) AS value
  `));
  return Boolean((databaseRows(result)[0] as { value?: boolean } | undefined)?.value);
}

export async function prepareAgentRun(input: {
  organizationId: string;
  userId?: string;
  conversationAuthorized?: boolean;
  agentId: string;
  conversationId: string;
  message: string;
  requestId: string;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
  media?: ProviderContentPart[];
  allowedToolIds?: readonly string[] | null;
}) {
  const [resolvedAgent] = await withDatabaseQuerySubsystem("agent", () => db().select({
    agent: agents,
    version: agentVersions,
  }).from(agents)
    .innerJoin(agentVersions, and(
      eq(agentVersions.agentId, agents.id),
      eq(agentVersions.version, agents.currentVersion),
    ))
    .where(and(
      eq(agents.id, input.agentId),
      eq(agents.organizationId, input.organizationId),
      eq(agents.status, "published"),
    ))
    .limit(1));
  if (!resolvedAgent) {
    throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير موجود أو غير منشور أو يفتقد الإصدار المنشور.");
  }
  const agent = resolvedAgent.agent;
  const version = resolvedAgent.version;

  const [organization, catalog, credentials, toolsEnabled] = await Promise.all([
    withDatabaseQuerySubsystem("provider", () => db().select({
      defaultProviderCredentialId: organizations.defaultProviderCredentialId,
      defaultModel: organizations.defaultModel,
    }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1)),
    withDatabaseQuerySubsystem("provider", () => db().select().from(modelCatalog).where(and(
      eq(modelCatalog.organizationId, input.organizationId),
      eq(modelCatalog.available, true),
    ))),
    withDatabaseQuerySubsystem("provider", () => db().select().from(providerCredentials).where(and(
      eq(providerCredentials.organizationId, input.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
    ))),
    hasEnabledAgentTools(input.organizationId, input.agentId, input.allowedToolIds),
  ]);
  const now = new Date();
  const usableCredentials = credentials.filter((credential) =>
    !credential.circuitOpenUntil || credential.circuitOpenUntil <= now);
  const credentialById = new Map(usableCredentials.map((credential) => [credential.id, credential]));
  const catalogByModel = new Map(catalog.map((entry) => [
    `${entry.providerCredentialId}:${entry.model}`,
    entry,
  ]));
  const routable = usableCredentials.flatMap((credential) => [...new Set([
    ...(credential.defaultModel ? [credential.defaultModel] : []),
    ...credential.allowedModels,
    ...credential.discoveredModels,
  ].map((model) => model.trim()).filter(Boolean))].map((model) => {
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
  if (input.model && inputKind === "image") {
    const selected = routable.find((candidate) => candidate.model === input.model
      && (!input.providerCredentialId || candidate.providerCredentialId === input.providerCredentialId));
    if (!selected?.available || selected.capabilities.vision !== true) {
      throw new ApiError(422, "VISION_MODEL_REQUIRED", "النموذج المحدد لا يدعم الصور. اختر نموذجًا يدعم الرؤية قبل إرسال المرفق.");
    }
  }
  if (input.model && inputKind === "file") {
    const selected = routable.find((candidate) => candidate.model === input.model
      && (!input.providerCredentialId || candidate.providerCredentialId === input.providerCredentialId));
    if (!selected?.available || selected.capabilities.files !== true) {
      throw new ApiError(422, "FILE_MODEL_REQUIRED", "النموذج المحدد لا يدعم سياق الملفات. اختر نموذجًا متوافقًا قبل الإرسال.");
    }
  }
  const ranked = rankModels(routable, inputKind).filter((candidate) => {
    if (!toolsEnabled) return true;
    const credential = credentialById.get(candidate.providerCredentialId);
    if (!credential) return false;
    asTransportMode(credential.transportMode);
    return candidate.capabilities.tools === true || candidate.capabilities.toolCalling === true;
  });
  const preferredCredentialId = input.providerCredentialId
    ?? agent.defaultProviderCredentialId
    ?? version.providerCredentialId;
  const preferredModel = input.model ?? agent.defaultModel ?? version.model;
  const explicitSelection = Boolean(input.providerCredentialId || input.model);
  const explicitMatch = (candidate: (typeof ranked)[number]) =>
    (!input.providerCredentialId || candidate.providerCredentialId === input.providerCredentialId)
    && (!input.model || candidate.model === input.model);
  const configuredAttempts = Number.parseInt(process.env.AI_PROVIDER_MAX_ATTEMPTS ?? "2", 10);
  const maxAttempts = Number.isSafeInteger(configuredAttempts) ? Math.min(3, Math.max(1, configuredAttempts)) : 2;
  const prioritized = explicitSelection
    ? ranked.filter(explicitMatch).slice(0, 1)
    : prioritizeProviderCandidates(
        ranked,
        (candidate) => candidate.providerCredentialId === preferredCredentialId && candidate.model === preferredModel,
        maxAttempts,
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

  const conversation = input.conversationAuthorized
    ? { id: input.conversationId }
    : await withDatabaseQuerySubsystem("conversation", async () => {
        const [row] = await db().select({ id: conversations.id })
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
        return row ?? null;
      });
  if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو مؤرشفة.");

  const context = await withDatabaseQuerySubsystem("conversation", () =>
    contextMessages(conversation.id, version.instructions, version.maxOutputTokens, input.media));
  const [run] = await withDatabaseQuerySubsystem("runs", () => db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${conversation.id}, 0))`);
    const [activeRun] = await tx.select({ id: runs.id }).from(runs).where(and(
      eq(runs.organizationId, input.organizationId),
      eq(runs.conversationId, conversation.id),
      inArray(runs.status, ["queued", "running", "waiting_approval"]),
    )).limit(1);
    if (activeRun) throw new ApiError(409, "RUN_ALREADY_ACTIVE", "يوجد رد قيد التنفيذ لهذه المحادثة. أوقفه أو انتظر اكتماله قبل إرسال طلب جديد.");
    const [created] = await tx.insert(runs).values({
      organizationId: input.organizationId,
      agentId: agent.id,
      agentVersionId: version.id,
      conversationId: conversation.id,
      status: "running",
      startedAt: new Date(),
      requestId: input.requestId,
      input: input.message,
      provider: primary.credential.provider,
      model: primary.model,
    }).returning();
    if (!created) throw new Error("RUN_CREATE_FAILED");
    await tx.insert(runEvents).values([
      {
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
      },
      { runId: created.id, sequence: 2, type: "run.running", payload: {} },
      { runId: created.id, sequence: 3, type: "provider.request.started", payload: {} },
    ]);
    return [created];
  }));

  return {
    run,
    candidates,
    version: { ...version, model: primary.model },
    context: context.messages,
    estimatedInputTokens: context.estimatedInputTokens,
    requestedProviderCredentialId: input.providerCredentialId ?? null,
    requestedModel: input.model ?? null,
    toolsEnabled,
  };
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
  requestId: string;
  startedAt: Date | null;
  streamingMessageCreated?: boolean;
  toolsEnabled?: boolean;
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
  const result = await withDatabaseQuerySubsystem("runs", () => db().transaction(async (tx) => {
    const latencyMs = input.startedAt
      ? Math.max(0, completedAt.getTime() - input.startedAt.getTime())
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
      requestId: input.requestId,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      latencyMs,
      errorCode: null,
      completedAt,
      providerCredentialId: input.providerCredentialId,
      model: input.model,
      metadata: { runId: input.runId, model: input.model, routing },
    };
    const [assistantMessage] = input.streamingMessageCreated
      ? await tx.update(messages).set(assistantValues).where(and(
          eq(messages.conversationId, input.conversationId),
          eq(messages.clientRequestId, input.runId),
          eq(messages.role, "assistant"),
          isNull(messages.deletedAt),
        )).returning()
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

    await tx.update(conversations).set({
      status: "active",
      providerCredentialId: input.providerCredentialId,
      model: input.model,
      lastMessageAt: completedAt,
      updatedAt: completedAt,
    }).where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
    ));
    await tx.execute(sql`
      WITH updated_credential AS (
        UPDATE provider_credentials
        SET validation_status = 'verified',
            health_status = 'healthy',
            consecutive_failures = 0,
            last_checked_at = ${completedAt},
            last_successful_at = ${completedAt},
            last_error_code = NULL,
            last_error_category = NULL,
            circuit_open_until = NULL,
            updated_at = ${completedAt}
        WHERE id = ${input.providerCredentialId}
          AND organization_id = ${input.organizationId}
        RETURNING id
      ), updated_model AS (
        UPDATE model_catalog
        SET available = true, last_seen_at = ${completedAt}, updated_at = ${completedAt}
        WHERE organization_id = ${input.organizationId}
          AND provider_credential_id = ${input.providerCredentialId}
          AND model = ${input.model}
        RETURNING id
      )
      INSERT INTO provider_credential_health_events (
        organization_id, provider_credential_id, run_id, outcome, model, request_id,
        provider_request_id, latency_ms, retryable
      ) VALUES (
        ${input.organizationId}, ${input.providerCredentialId}, ${input.runId}, 'completed', ${input.model},
        ${input.requestId}, ${input.providerRequestId ?? null}, ${latencyMs}, false
      )
    `);
    return { run: completed, assistantMessage };
  }));
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
  if (input.toolsEnabled) await deleteRunCheckpoints(input.organizationId, input.runId);
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
  conversationAuthorized?: boolean;
  agentId: string;
  message: string;
  conversationId: string;
  requestId?: string;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
  media?: ProviderContentPart[];
  allowedToolIds?: readonly string[] | null;
}) {
  const requestId = input.requestId ?? crypto.randomUUID();
  const prepared = await prepareAgentRun({ ...input, requestId });
  const controller = new AbortController();
  activeControllers.set(prepared.run.id, controller);
  const allocateStep = freshRunStepAllocator();
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
          allowedToolIds: input.allowedToolIds,
          toolsEnabled: prepared.toolsEnabled,
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
          requestId,
          startedAt: prepared.run.startedAt,
          toolsEnabled: prepared.toolsEnabled,
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
  conversationAuthorized?: boolean;
  agentId: string;
  message: string;
  conversationId: string;
  requestId: string;
  requestSignal?: AbortSignal;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
  media?: ProviderContentPart[];
  allowedToolIds?: readonly string[] | null;
  onProviderAttempt?: (event: { phase: "start" | "end"; attempt: number; activeProviderRequests: number; holdMs?: number }) => void;
}) {
  const prepared = await prepareAgentRun(input);
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(input.requestSignal?.reason);
  input.requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  activeControllers.set(prepared.run.id, controller);
  const allocateStep = freshRunStepAllocator();
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
      input.onProviderAttempt?.({ phase: "start", attempt: attemptCount, activeProviderRequests: activeProviderRequests + 1 });
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
          allowedToolIds: input.allowedToolIds,
          toolsEnabled: prepared.toolsEnabled,
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
        if (!candidateResult) throw new ProviderError("PROVIDER_STREAM_INTERRUPTED", "انتهى بث المزود قبل اكتمال النتيجة.", 502, undefined, true);
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
          requestId: input.requestId,
          startedAt: prepared.run.startedAt,
          streamingMessageCreated,
          toolsEnabled: prepared.toolsEnabled,
        });
        yield {
          type: "complete" as const,
          runId: prepared.run.id,
          messageId: completed.assistantMessage?.id,
          usage: candidateResult.usage,
          model: candidate.model,
          fallbackUsed: attemptCount > 1,
          attemptCount,
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
  role?: Role;
  page: number;
  limit: number;
  status?: RunStatusFilter;
}) {
  const where = and(
    eq(runs.organizationId, input.organizationId),
    input.status ? eq(runs.status, input.status) : undefined,
    input.userId && input.role
      ? conversationAccessFilter({ role: input.role, userId: input.userId, access: "read" })
      : input.userId ? eq(conversations.createdByUserId, input.userId) : undefined,
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
