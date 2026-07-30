import { and, eq } from "drizzle-orm";
import { type ModelMessage, type ToolApprovalResponse } from "ai";
import { db } from "@/db";
import { agentVersions, modelCatalog, providerCredentials, runs } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { decryptSecret } from "@/lib/security/encryption";
import { inferModelCapabilities } from "@/server/models/capabilities";
import { executeAiSdkCandidate, AiSdkCandidateError } from "@/lib/ai-sdk/runtime";
import { createRunStepAllocator, persistRunStep } from "@/lib/ai-sdk/run-steps";
import { loadRunCheckpoint } from "@/lib/ai-sdk/checkpoints";
import {
  consumeToolApproval,
  getToolApprovalForResume,
} from "@/lib/ai-sdk/approvals";
import { completeAgentRun, failAgentRun } from "@/lib/agents/runtime";

function checkpointMessages(value: unknown[]): ModelMessage[] {
  if (!Array.isArray(value)) throw new ApiError(409, "RUN_CHECKPOINT_INVALID", "نقطة الاستئناف لا تحتوي سياقًا صالحًا.");
  return value as ModelMessage[];
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

  const approved = approval.status === "approved";
  const approvalResponse: ToolApprovalResponse = {
    type: "tool-approval-response",
    approvalId: approval.approvalId,
    approved,
    reason: approval.reason ?? (approved ? "Approved by an authorized organization user." : "Rejected by an authorized organization user."),
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
        apiKey: decryptSecret(credential.encryptedSecret),
        baseUrl: credential.baseUrl,
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
    return completed.run;
  } catch (error) {
    if (error instanceof AiSdkCandidateError) {
      await failAgentRun(input.organizationId, run.id, error.providerError, error.executionState);
      throw error.providerError;
    }
    throw error;
  }
}
