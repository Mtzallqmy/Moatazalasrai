import { and, eq } from "drizzle-orm";
import { type ModelMessage, type ToolApprovalResponse } from "ai";
import { db } from "@/db";
import {
  agentTeamRunsRuntime,
  agentTeamRunStepsRuntime,
} from "@/db/agent-runtime-schema";
import { agentVersions, modelCatalog, providerCredentials, runs } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { inferModelCapabilities } from "@/server/models/capabilities";
import { asProviderTypeId, asTransportMode, resolveProviderApiKey } from "@/lib/providers/provider-config";
import { executeAiSdkCandidate, AiSdkCandidateError } from "@/lib/ai-sdk/runtime";
import { createRunStepAllocator, persistRunStep } from "@/lib/ai-sdk/run-steps";
import { loadRunCheckpoint } from "@/lib/ai-sdk/checkpoints";
import {
  consumeToolApproval,
  getToolApprovalForResume,
} from "@/lib/ai-sdk/approvals";
import { completeAgentRun, failAgentRun } from "@/lib/agents/runtime";
import { enqueueAgentTeamRun } from "@/worker/queue";

function checkpointMessages(value: unknown[]): ModelMessage[] {
  if (!Array.isArray(value)) throw new ApiError(409, "RUN_CHECKPOINT_INVALID", "نقطة الاستئناف لا تحتوي سياقًا صالحًا.");
  return value as ModelMessage[];
}

async function resumeOwningTeamRun(input: {
  organizationId: string;
  runId: string;
  output: string;
}) {
  const [step] = await db().select().from(agentTeamRunStepsRuntime).where(and(
    eq(agentTeamRunStepsRuntime.organizationId, input.organizationId),
    eq(agentTeamRunStepsRuntime.runId, input.runId),
  )).limit(1);
  if (!step) return;
  await db().transaction(async (tx) => {
    await tx.update(agentTeamRunStepsRuntime).set({
      status: "completed",
      output: input.output,
      errorCode: null,
      completedAt: new Date(),
    }).where(and(
      eq(agentTeamRunStepsRuntime.id, step.id),
      eq(agentTeamRunStepsRuntime.organizationId, input.organizationId),
    ));
    await tx.update(agentTeamRunsRuntime).set({
      status: "queued",
      errorCode: null,
      completedAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(agentTeamRunsRuntime.id, step.teamRunId),
      eq(agentTeamRunsRuntime.organizationId, input.organizationId),
      eq(agentTeamRunsRuntime.status, "waiting_approval"),
    ));
  });
  await enqueueAgentTeamRun({ organizationId: input.organizationId, teamRunId: step.teamRunId });
}

export async function resumeAgentRunAfterApproval(input: {
  organizationId: string;
  approvalId: string;
}) {
  const approval = await getToolApprovalForResume(input.organizationId, input.approvalId);
  const { state } = await loadRunCheckpoint(input.organizationId, approval.runId!);
  if (state.pendingApproval.approvalId !== approval.approvalId
    || state.pendingApproval.toolCallId !== approval.toolCallId) {
    throw new ApiError(409, "RUN_CHECKPOINT_APPROVAL_MISMATCH", "لا يطابق قرار الموافقة نقطة استئناف التشغيل.");
  }

  const [run, credential] = await Promise.all([
    db().select().from(runs).where(and(
      eq(runs.id, approval.runId!),
      eq(runs.organizationId, input.organizationId),
    )).limit(1).then((rows) => rows[0]),
    db().select().from(providerCredentials).where(and(
      eq(providerCredentials.id, state.providerCredentialId),
      eq(providerCredentials.organizationId, input.organizationId),
      eq(providerCredentials.enabled, true),
      eq(providerCredentials.validationStatus, "verified"),
    )).limit(1).then((rows) => rows[0]),
  ]);
  if (!run) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
  if (run.status === "completed" || run.status === "cancelled") return run;
  if (!credential) throw new ApiError(409, "PROVIDER_UNAVAILABLE", "المزود المرتبط بنقطة الاستئناف غير متاح.");

  const [version, catalog] = await Promise.all([
    db().select().from(agentVersions).where(eq(agentVersions.id, run.agentVersionId)).limit(1).then((rows) => rows[0]),
    db().select({ capabilities: modelCatalog.capabilities }).from(modelCatalog).where(and(
      eq(modelCatalog.organizationId, input.organizationId),
      eq(modelCatalog.providerCredentialId, credential.id),
      eq(modelCatalog.model, state.model),
    )).limit(1).then((rows) => rows[0]),
  ]);
  if (!version) throw new ApiError(409, "AGENT_VERSION_MISSING", "إصدار الوكيل المرتبط بالتشغيل غير متاح.");
  const transportMode = asTransportMode(credential.transportMode);
  if (transportMode === "cloudflare_ai_gateway_rest" || transportMode === "cloudflare_workers_ai") {
    throw new ApiError(
      422,
      "PROVIDER_APPROVAL_RESUME_UNSUPPORTED",
      "هذا المزود لا يدعم استئناف أدوات الخادم بعد الموافقة. استخدم مزودًا مباشرًا أو AI Gateway provider-native.",
    );
  }

  const approved = approval.status === "approved";
  const approvalResponse: ToolApprovalResponse = {
    type: "tool-approval-response",
    approvalId: approval.approvalId,
    approved,
    reason: approval.reason ?? (approved
      ? "Approved by an authorized organization user."
      : "Rejected by an authorized organization user."),
  };
  const messages: ModelMessage[] = [
    ...checkpointMessages(state.messages),
    { role: "tool", content: [approvalResponse] },
  ];
  await db().update(runs).set({
    status: "running",
    error: null,
    errorCode: null,
    completedAt: null,
  }).where(and(eq(runs.id, run.id), eq(runs.organizationId, input.organizationId)));

  const allocateStep = await createRunStepAllocator(input.organizationId, run.id);
  await persistRunStep({
    organizationId: input.organizationId,
    runId: run.id,
    stepNumber: allocateStep(),
    stepType: "approval_response",
    status: "completed",
    toolCallId: approval.toolCallId ?? undefined,
    toolId: state.pendingApproval.toolId,
    output: { approved },
    metadata: { approvalId: approval.approvalId },
  });

  try {
    const result = await executeAiSdkCandidate({
      organizationId: input.organizationId,
      userId: approval.decidedByUserId,
      agentId: state.agentId,
      runId: run.id,
      conversationId: state.conversationId,
      requestId: state.requestId,
      candidateIndex: state.candidateIndex,
      candidate: {
        providerCredentialId: credential.id,
        provider: credential.provider,
        providerTypeId: asProviderTypeId(credential.providerTypeId, credential.provider),
        transportMode,
        apiKey: resolveProviderApiKey(credential, input.organizationId),
        baseUrl: credential.baseUrl,
        gatewayId: credential.gatewayId ?? undefined,
        keyAlias: credential.keyAlias ?? undefined,
        skipCache: credential.gatewaySkipCache,
        cacheTtl: credential.gatewayCacheTtl ?? undefined,
        collectLog: credential.gatewayCollectLog,
        model: state.model,
        capabilities: {
          ...inferModelCapabilities(credential.provider, state.model),
          ...(catalog?.capabilities ?? {}),
        },
      },
      resumeMessages: messages,
      temperature: version.temperatureMilli / 1000,
      maxOutputTokens: version.maxOutputTokens,
      allocateStep,
    });
    await consumeToolApproval({ organizationId: input.organizationId, approvalId: approval.approvalId });
    if (result.status === "waiting_approval") {
      const [waiting] = await db().select().from(runs).where(and(
        eq(runs.id, run.id),
        eq(runs.organizationId, input.organizationId),
      )).limit(1);
      return waiting ?? run;
    }
    if (!result.text.trim()) throw new ApiError(502, "PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا بعد قرار الموافقة.");
    const completed = await completeAgentRun({
      organizationId: input.organizationId,
      runId: run.id,
      conversationId: state.conversationId,
      providerCredentialId: credential.id,
      text: result.text,
      usage: result.usage,
      providerRequestId: result.providerRequestId,
      model: state.model,
      attemptCount: state.candidateIndex + 1,
      requestedProviderCredentialId: null,
      requestedModel: null,
    });
    await resumeOwningTeamRun({
      organizationId: input.organizationId,
      runId: run.id,
      output: result.text,
    });
    return completed.run;
  } catch (error) {
    if (error instanceof AiSdkCandidateError) {
      await failAgentRun(input.organizationId, run.id, error.providerError, error.executionState);
      throw error.providerError;
    }
    throw error;
  }
}
