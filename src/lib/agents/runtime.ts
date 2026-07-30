import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { providerCredentialHealthEvents } from "@/db/provider-health-schema";
import {
  agentVersions,
  agents,
  conversations,
  messages,
  modelCatalog,
  organizations,
  providerCredentials,
  runEvents,
  runs,
} from "@/db/schema";
import { rankModels, type InputKind } from "@/server/models/router";
import { decryptSecret } from "@/lib/security/encryption";
import { ApiError } from "@/lib/http/api";
import {
  isCredentialScopedProviderError,
  prioritizeProviderCandidates,
  providerCircuitOpenUntil,
  shouldFallbackProviderError,
} from "@/lib/providers/failure-policy";
import { generateWithProvider, streamWithProvider } from "@/lib/providers/registry";
import { ProviderError, type ProviderContentPart, type ProviderMessage, type ProviderUsage } from "@/lib/providers/types";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";

const activeControllers = new Map<string, AbortController>();
const MAX_CONTEXT_TOKENS_ESTIMATE = 24_000;
const MAX_CONTEXT_MESSAGES = 80;

function estimatedTokens(content: string) {
  return Math.ceil(content.length / 4) + 8;
}

function safeProviderError(error: unknown) {
  if (error instanceof ProviderError) return error;
  return new ProviderError("RUN_FAILED", "تعذر إكمال تشغيل الوكيل.", 502);
}

async function contextMessages(conversationId: string, instructions: string, maxOutputTokens: number, media: ProviderContentPart[] = []) {
  const rows = await db().select({
    role: messages.role,
    content: messages.content,
  }).from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
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
      if (history[index]?.role === "user") { latestUser = index; break; }
    }
    if (latestUser >= 0) history[latestUser] = {
      ...history[latestUser]!,
      content: [{ type: "text", text: String(history[latestUser]!.content) }, ...media],
    };
  }
  return {
    messages: [
      { role: "system", content: instructions },
      ...history,
    ] satisfies ProviderMessage[],
    estimatedInputTokens: used,
  };
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

  const [organization, catalog, credentials] = await Promise.all([
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
  const ranked = rankModels(routable, inputKind);
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
    return credential ? [{ credential, model: candidate.model }] : [];
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

async function beginProviderRequest(runId: string) {
  await db().transaction(async (tx) => {
    await tx.update(runs).set({ status: "running", startedAt: new Date() }).where(eq(runs.id, runId));
    await tx.insert(runEvents).values([
      { runId, sequence: 2, type: "run.running", payload: {} },
      { runId, sequence: 3, type: "provider.request.started", payload: {} },
    ]);
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
        validationStatus: providerCredentials.validationStatus,
      }).from(providerCredentials).where(and(
        eq(providerCredentials.id, input.providerCredentialId),
        eq(providerCredentials.organizationId, input.organizationId),
      )).limit(1);
      if (!credential) return;
      const failures = credential.failures + 1;
      const circuitOpenUntil = providerCircuitOpenUntil(input.error, failures);
      const invalidCredential = input.error.code === "PROVIDER_UNAUTHORIZED"
        || input.error.code === "PROVIDER_FORBIDDEN";
      await tx.update(providerCredentials).set({
        consecutiveFailures: failures,
        lastErrorCode: input.error.code,
        circuitOpenUntil,
        ...(invalidCredential ? { validationStatus: "failed" as const } : {}),
        updatedAt: new Date(),
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

async function completeRun(input: {
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
  return db().transaction(async (tx) => {
    const routing = {
      attemptCount: input.attemptCount,
      fallbackUsed,
      requestedProviderCredentialId: input.requestedProviderCredentialId,
      requestedModel: input.requestedModel,
      providerCredentialId: input.providerCredentialId,
      model: input.model,
    };
    const [assistantMessage] = await tx.insert(messages).values({
      conversationId: input.conversationId,
      role: "assistant",
      content: input.text,
      providerCredentialId: input.providerCredentialId,
      model: input.model,
      metadata: { runId: input.runId, model: input.model, routing },
    }).returning();
    const [completed] = await tx.update(runs).set({
      status: "completed",
      output: input.text,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      providerRequestId: input.providerRequestId,
      completedAt,
    }).where(eq(runs.id, input.runId)).returning();
    await tx.insert(runEvents).values([
      {
        runId: input.runId,
        sequence: 4,
        type: "provider.request.completed",
        payload: {
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          providerRequestId: input.providerRequestId,
          routing,
        },
      },
      { runId: input.runId, sequence: 5, type: "run.completed", payload: { fallbackUsed } },
    ]);
    await tx.update(conversations).set({ updatedAt: completedAt }).where(eq(conversations.id, input.conversationId));
    await tx.update(providerCredentials).set({
      validationStatus: "verified",
      consecutiveFailures: 0,
      lastErrorCode: null,
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
      retryable: false,
    });
    return { run: completed, assistantMessage };
  });
}

async function failRun(runId: string, error: ProviderError) {
  console.error(JSON.stringify(safeTelemetry({ operation: "agent.run", runId, status: "error", errorCode: error.code })));
  await db().transaction(async (tx) => {
    await tx.update(runs).set({
      status: error.code === "PROVIDER_CANCELLED" ? "cancelled" : "failed",
      error: error.message,
      errorCode: error.code,
      completedAt: new Date(),
    }).where(eq(runs.id, runId));
    await tx.insert(runEvents).values([
      {
        runId,
        sequence: 4,
        type: error.code === "PROVIDER_CANCELLED" ? "run.cancelled" : "provider.request.failed",
        payload: { code: error.code, providerStatus: error.providerStatus },
      },
      ...(error.code === "PROVIDER_CANCELLED"
        ? []
        : [{ runId, sequence: 5, type: "run.failed", payload: { code: error.code } }]),
    ]);
  });
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
  await beginProviderRequest(prepared.run.id);
  const controller = new AbortController();
  activeControllers.set(prepared.run.id, controller);
  try {
    let lastError: ProviderError | undefined;
    let attemptCount = 0;
    const blockedCredentialIds = new Set<string>();
    for (const candidate of prepared.candidates) {
      if (blockedCredentialIds.has(candidate.credential.id)) continue;
      attemptCount += 1;
      if (attemptCount > 1) {
        await db().update(runs).set({
          provider: candidate.credential.provider,
          model: candidate.model,
        }).where(eq(runs.id, prepared.run.id));
      }
      try {
        const result = await generateWithProvider(candidate.credential.provider, {
          apiKey: decryptSecret(candidate.credential.encryptedSecret),
          baseUrl: candidate.credential.baseUrl,
          model: candidate.model,
          messages: prepared.context,
          temperature: prepared.version.temperatureMilli / 1000,
          maxOutputTokens: prepared.version.maxOutputTokens,
          signal: controller.signal,
          requestId,
        });
        return completeRun({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          conversationId: input.conversationId,
          providerCredentialId: candidate.credential.id,
          text: result.text,
          usage: result,
          providerRequestId: result.providerRequestId,
          model: candidate.model,
          attemptCount,
          requestedProviderCredentialId: prepared.requestedProviderCredentialId,
          requestedModel: prepared.requestedModel,
        });
      } catch (error) {
        const safe = safeProviderError(error);
        lastError = safe;
        await recordCredentialFailure({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          providerCredentialId: candidate.credential.id,
          model: candidate.model,
          error: safe,
        });
        if (isCredentialScopedProviderError(safe)) blockedCredentialIds.add(candidate.credential.id);
        if (!shouldFallbackProviderError(safe)) break;
      }
    }
    const safe = lastError ?? new ProviderError("RUN_FAILED", "تعذر إكمال تشغيل الوكيل.", 502);
    await failRun(prepared.run.id, safe);
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
  await beginProviderRequest(prepared.run.id);
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(input.requestSignal?.reason);
  input.requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  activeControllers.set(prepared.run.id, controller);
  yield { type: "run" as const, runId: prepared.run.id };
  let text = "";
  let usage: ProviderUsage = { inputTokens: null, outputTokens: null };
  let providerRequestId: string | undefined;
  let activeCandidate = prepared.candidates[0]!;
  let attemptCount = 0;
  let lastError: ProviderError | undefined;
  const blockedCredentialIds = new Set<string>();
  try {
    let providerCompleted = false;
    for (const candidate of prepared.candidates) {
      if (blockedCredentialIds.has(candidate.credential.id)) continue;
      activeCandidate = candidate;
      attemptCount += 1;
      if (attemptCount > 1) {
        await db().update(runs).set({
          provider: candidate.credential.provider,
          model: candidate.model,
        }).where(eq(runs.id, prepared.run.id));
      }
      try {
        for await (const chunk of streamWithProvider(candidate.credential.provider, {
          apiKey: decryptSecret(candidate.credential.encryptedSecret),
          baseUrl: candidate.credential.baseUrl,
          model: candidate.model,
          messages: prepared.context,
          temperature: prepared.version.temperatureMilli / 1000,
          maxOutputTokens: prepared.version.maxOutputTokens,
          signal: controller.signal,
          requestId: input.requestId,
        })) {
          if (chunk.type === "delta") {
            text += chunk.text;
            yield chunk;
          } else if (chunk.type === "usage") {
            usage = chunk.usage;
            providerRequestId = chunk.providerRequestId ?? providerRequestId;
          } else {
            providerRequestId = chunk.providerRequestId ?? providerRequestId;
          }
        }
        providerCompleted = true;
        break;
      } catch (error) {
        const safe = safeProviderError(error);
        lastError = safe;
        await recordCredentialFailure({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          providerCredentialId: candidate.credential.id,
          model: candidate.model,
          error: safe,
        });
        if (isCredentialScopedProviderError(safe)) blockedCredentialIds.add(candidate.credential.id);
        const mayFallback = text.length === 0 && shouldFallbackProviderError(safe);
        if (!mayFallback) throw safe;
        usage = { inputTokens: null, outputTokens: null };
        providerRequestId = undefined;
      }
    }
    if (!providerCompleted || !text.trim()) {
      const safe = lastError ?? new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
      if (!lastError) {
        await recordCredentialFailure({
          organizationId: input.organizationId,
          runId: prepared.run.id,
          providerCredentialId: activeCandidate.credential.id,
          model: activeCandidate.model,
          error: safe,
        });
      }
      throw safe;
    }
    const completed = await completeRun({
      organizationId: input.organizationId,
      runId: prepared.run.id,
      conversationId: input.conversationId,
      providerCredentialId: activeCandidate.credential.id,
      text,
      usage,
      providerRequestId,
      model: activeCandidate.model,
      attemptCount,
      requestedProviderCredentialId: prepared.requestedProviderCredentialId,
      requestedModel: prepared.requestedModel,
    });
    yield {
      type: "complete" as const,
      runId: prepared.run.id,
      messageId: completed.assistantMessage.id,
      usage,
      model: activeCandidate.model,
      fallbackUsed: attemptCount > 1,
    };
  } catch (error) {
    const safe = safeProviderError(error);
    await failRun(prepared.run.id, safe);
    throw new ApiError(safe.httpStatus, safe.code, safe.message, {
      runId: prepared.run.id,
      providerStatus: safe.providerStatus,
    });
  } finally {
    activeControllers.delete(prepared.run.id);
    input.requestSignal?.removeEventListener("abort", abortFromRequest);
  }
}

export async function cancelAgentRun(organizationId: string, runId: string) {
  const [run] = await db().select({ id: runs.id, status: runs.status })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)))
    .limit(1);
  if (!run) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
  if (!["queued", "running"].includes(run.status)) return { cancelled: false, status: run.status };
  activeControllers.get(runId)?.abort();
  await db().update(runs).set({ cancelRequestedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.organizationId, organizationId)));
  return { cancelled: true, status: "cancelling" };
}

export async function listOrganizationRuns(input: {
  organizationId: string;
  userId?: string;
  page: number;
  limit: number;
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
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
