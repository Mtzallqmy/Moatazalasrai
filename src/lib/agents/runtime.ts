import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
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
import { selectBestModel, type InputKind } from "@/server/models/router";
import { decryptSecret } from "@/lib/security/encryption";
import { ApiError } from "@/lib/http/api";
import { generateWithProvider, streamWithProvider } from "@/lib/providers/registry";
import { ProviderError, type ProviderMessage, type ProviderUsage } from "@/lib/providers/types";

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

async function contextMessages(conversationId: string, instructions: string, maxOutputTokens: number) {
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
  return {
    messages: [
      { role: "system", content: instructions },
      ...selected.map((message) => ({ role: message.role, content: message.content })),
    ] satisfies ProviderMessage[],
    estimatedInputTokens: used,
  };
}

export async function prepareAgentRun(input: {
  organizationId: string;
  agentId: string;
  conversationId: string;
  message: string;
  requestId: string;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
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

  let selectedProviderId = input.providerCredentialId ?? version.providerCredentialId;
  let selectedModel = input.model ?? version.model;
  if (!input.providerCredentialId && !input.model && input.inputKind) {
    const [organization, catalog] = await Promise.all([
      db().select({
        defaultProviderCredentialId: organizations.defaultProviderCredentialId,
        defaultModel: organizations.defaultModel,
      }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1),
      db().select().from(modelCatalog).where(and(
        eq(modelCatalog.organizationId, input.organizationId),
        eq(modelCatalog.available, true),
      )),
    ]);
    const routed = selectBestModel(catalog.map((entry) => ({
      providerCredentialId: entry.providerCredentialId,
      model: entry.model,
      available: entry.available,
      freeTierEligible: entry.freeTierEligible,
      latencyMs: entry.latencyMs,
      capabilities: entry.capabilities,
      isAgentDefault: entry.providerCredentialId === (agent.defaultProviderCredentialId ?? version.providerCredentialId)
        && entry.model === (agent.defaultModel ?? version.model),
      isOrganizationDefault: entry.providerCredentialId === organization[0]?.defaultProviderCredentialId
        && entry.model === organization[0]?.defaultModel,
    })), input.inputKind);
    if (routed) {
      selectedProviderId = routed.providerCredentialId;
      selectedModel = routed.model;
    }
  }
  const [credential] = await db().select().from(providerCredentials)
    .where(and(
      eq(providerCredentials.id, selectedProviderId),
      eq(providerCredentials.organizationId, input.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
    ))
    .limit(1);
  if (!credential) throw new ApiError(422, "PROVIDER_UNAVAILABLE", "المزود معطل أو لم يجتز آخر فحص.");
  if (!credential.discoveredModels.includes(selectedModel)) {
    throw new ApiError(422, "MODEL_UNAVAILABLE", "النموذج غير موجود في قائمة النماذج المكتشفة للمزود.");
  }
  if (credential.circuitOpenUntil && credential.circuitOpenUntil > new Date()) {
    throw new ApiError(503, "PROVIDER_COOLDOWN", "المزود في فترة تهدئة مؤقتة بعد إخفاقات متكررة.");
  }

  const [conversation] = await db().select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
      eq(conversations.agentId, agent.id),
      isNull(conversations.archivedAt),
      isNull(conversations.deletedAt),
    ))
    .limit(1);
  if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو مؤرشفة.");

  const context = await contextMessages(conversation.id, version.instructions, version.maxOutputTokens);
  const [run] = await db().transaction(async (tx) => {
    const [created] = await tx.insert(runs).values({
      organizationId: input.organizationId,
      agentId: agent.id,
      agentVersionId: version.id,
      conversationId: conversation.id,
      status: "queued",
      requestId: input.requestId,
      input: input.message,
      provider: credential.provider,
      model: selectedModel,
    }).returning();
    if (!created) throw new Error("RUN_CREATE_FAILED");
    await tx.insert(runEvents).values({
      runId: created.id,
      sequence: 1,
      type: "run.created",
      payload: { agentId: agent.id, version: version.version, requestId: input.requestId },
    });
    return [created];
  });

  return {
    run,
    credential,
    version: { ...version, model: selectedModel },
    context: context.messages,
    estimatedInputTokens: context.estimatedInputTokens,
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

async function completeRun(input: {
  runId: string;
  conversationId: string;
  providerCredentialId: string;
  text: string;
  usage: ProviderUsage;
  providerRequestId?: string;
  model: string;
}) {
  const completedAt = new Date();
  return db().transaction(async (tx) => {
    const [assistantMessage] = await tx.insert(messages).values({
      conversationId: input.conversationId,
      role: "assistant",
      content: input.text,
      providerCredentialId: input.providerCredentialId,
      model: input.model,
      metadata: { runId: input.runId, model: input.model },
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
        },
      },
      { runId: input.runId, sequence: 5, type: "run.completed", payload: {} },
    ]);
    await tx.update(conversations).set({ updatedAt: completedAt }).where(eq(conversations.id, input.conversationId));
    await tx.update(providerCredentials).set({
      consecutiveFailures: 0,
      lastErrorCode: null,
      circuitOpenUntil: null,
      updatedAt: completedAt,
    }).where(eq(providerCredentials.id, input.providerCredentialId));
    return { run: completed, assistantMessage };
  });
}

async function failRun(runId: string, error: ProviderError) {
  const failureCountRows = await db().select({ providerCredentialId: agentVersions.providerCredentialId })
    .from(runs)
    .innerJoin(agentVersions, eq(agentVersions.id, runs.agentVersionId))
    .where(eq(runs.id, runId))
    .limit(1);
  const credentialId = failureCountRows[0]?.providerCredentialId;
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
    if (credentialId && error.code !== "PROVIDER_CANCELLED") {
      const [credential] = await tx.select({ failures: providerCredentials.consecutiveFailures })
        .from(providerCredentials)
        .where(eq(providerCredentials.id, credentialId))
        .limit(1);
      const failures = (credential?.failures ?? 0) + 1;
      await tx.update(providerCredentials).set({
        consecutiveFailures: failures,
        lastErrorCode: error.code,
        circuitOpenUntil: failures >= 3 ? new Date(Date.now() + 5 * 60_000) : null,
        updatedAt: new Date(),
      }).where(eq(providerCredentials.id, credentialId));
    }
  });
}

export async function executeAgentRun(input: {
  organizationId: string;
  agentId: string;
  message: string;
  conversationId: string;
  requestId?: string;
}) {
  const requestId = input.requestId ?? crypto.randomUUID();
  const prepared = await prepareAgentRun({ ...input, requestId });
  await beginProviderRequest(prepared.run.id);
  const controller = new AbortController();
  activeControllers.set(prepared.run.id, controller);
  try {
    const result = await generateWithProvider(prepared.credential.provider, {
      apiKey: decryptSecret(prepared.credential.encryptedSecret),
      baseUrl: prepared.credential.baseUrl,
      model: prepared.version.model,
      messages: prepared.context,
      temperature: prepared.version.temperatureMilli / 1000,
      maxOutputTokens: prepared.version.maxOutputTokens,
      signal: controller.signal,
      requestId,
    });
    return completeRun({
      runId: prepared.run.id,
      conversationId: input.conversationId,
      providerCredentialId: prepared.credential.id,
      text: result.text,
      usage: result,
      providerRequestId: result.providerRequestId,
      model: prepared.version.model,
    });
  } catch (error) {
    const safe = safeProviderError(error);
    await failRun(prepared.run.id, safe);
    throw new ApiError(safe.httpStatus, safe.code, safe.message, { runId: prepared.run.id });
  } finally {
    activeControllers.delete(prepared.run.id);
  }
}

export async function* streamAgentRun(input: {
  organizationId: string;
  agentId: string;
  message: string;
  conversationId: string;
  requestId: string;
  requestSignal?: AbortSignal;
  providerCredentialId?: string;
  model?: string;
  inputKind?: InputKind;
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
  try {
    for await (const chunk of streamWithProvider(prepared.credential.provider, {
      apiKey: decryptSecret(prepared.credential.encryptedSecret),
      baseUrl: prepared.credential.baseUrl,
      model: prepared.version.model,
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
    if (!text.trim()) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
    const completed = await completeRun({
      runId: prepared.run.id,
      conversationId: input.conversationId,
      providerCredentialId: prepared.credential.id,
      text,
      usage,
      providerRequestId,
      model: prepared.version.model,
    });
    yield {
      type: "complete" as const,
      runId: prepared.run.id,
      messageId: completed.assistantMessage.id,
      usage,
    };
  } catch (error) {
    const safe = safeProviderError(error);
    await failRun(prepared.run.id, safe);
    throw new ApiError(safe.httpStatus, safe.code, safe.message, { runId: prepared.run.id });
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
  page: number;
  limit: number;
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
}) {
  const where = input.status
    ? and(eq(runs.organizationId, input.organizationId), eq(runs.status, input.status))
    : eq(runs.organizationId, input.organizationId);
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
      .where(where)
      .orderBy(desc(runs.createdAt))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db().select({ value: count() }).from(runs).where(where),
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
