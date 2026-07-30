import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import { auditLogs, runs } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { encryptSecret, decryptSecret } from "@/lib/security/encryption";
import { toolApprovalTtlSeconds } from "@/lib/ai-sdk/limits";
import { appendRunEvent } from "@/lib/ai-sdk/run-events";
import { persistRunStep } from "@/lib/ai-sdk/run-steps";
import { saveRunCheckpoint, type AgentRunCheckpointState } from "@/lib/ai-sdk/checkpoints";
import { redactedArgumentSummary } from "@/lib/ai-sdk/approval-policy";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export async function requestToolApproval(input: {
  organizationId: string;
  userId?: string | null;
  runId: string;
  agentId: string;
  serverId: string;
  toolId: string;
  toolCallId: string;
  approvalId: string;
  arguments: Record<string, unknown>;
  reason: string;
  risk: string;
  capability: string;
  stepNumber: number;
  checkpoint: AgentRunCheckpointState;
}) {
  const [existing] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, input.organizationId),
    eq(toolApprovalsRuntime.runId, input.runId),
    eq(toolApprovalsRuntime.toolCallId, input.toolCallId),
  )).limit(1);
  if (existing) return existing;

  await saveRunCheckpoint({
    organizationId: input.organizationId,
    runId: input.runId,
    state: input.checkpoint,
  });
  const expiresAt = new Date(Date.now() + toolApprovalTtlSeconds() * 1000);
  const approval = await db().transaction(async (tx) => {
    const [created] = await tx.insert(toolApprovalsRuntime).values({
      organizationId: input.organizationId,
      runId: input.runId,
      toolId: input.toolId,
      inputDigest: digest(input.arguments),
      status: "pending",
      requestedByUserId: input.userId,
      expiresAt,
      approvalId: input.approvalId,
      toolCallId: input.toolCallId,
      serverId: input.serverId,
      agentId: input.agentId,
      encryptedArguments: encryptSecret(JSON.stringify(input.arguments)),
      reason: input.reason,
      risk: input.risk,
      capability: input.capability,
    }).returning();
    if (!created) throw new Error("TOOL_APPROVAL_CREATE_FAILED");
    await tx.update(runs).set({ status: "waiting_approval" }).where(and(
      eq(runs.id, input.runId),
      eq(runs.organizationId, input.organizationId),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "agent",
      actorId: input.agentId,
      action: "tool_approval.requested",
      resourceType: "tool_approval",
      resourceId: created.id,
      metadata: {
        runId: input.runId,
        toolId: input.toolId,
        toolCallId: input.toolCallId,
        risk: input.risk,
        capability: input.capability,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return created;
  });
  await persistRunStep({
    organizationId: input.organizationId,
    runId: input.runId,
    stepNumber: input.stepNumber,
    stepType: "approval_requested",
    status: "waiting_approval",
    toolCallId: input.toolCallId,
    toolId: input.toolId,
    input: input.arguments,
    metadata: { approvalId: input.approvalId, risk: input.risk, capability: input.capability },
  });
  await appendRunEvent({
    organizationId: input.organizationId,
    runId: input.runId,
    type: "approval.requested",
    payload: {
      approvalId: input.approvalId,
      toolId: input.toolId,
      toolCallId: input.toolCallId,
      risk: input.risk,
      expiresAt: expiresAt.toISOString(),
    },
  });
  return approval;
}

export async function listPendingToolApprovals(organizationId: string) {
  const now = new Date();
  await db().update(toolApprovalsRuntime).set({ status: "expired", updatedAt: now }).where(and(
    eq(toolApprovalsRuntime.organizationId, organizationId),
    eq(toolApprovalsRuntime.status, "pending"),
  ));
  const rows = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, organizationId),
    eq(toolApprovalsRuntime.status, "pending"),
    gt(toolApprovalsRuntime.expiresAt, now),
  )).orderBy(desc(toolApprovalsRuntime.createdAt));
  return rows.map((row) => ({
    ...row,
    encryptedArguments: undefined,
    argumentsSummary: row.encryptedArguments
      ? redactedArgumentSummary(JSON.parse(decryptSecret(row.encryptedArguments)))
      : {},
  }));
}

export async function getToolApproval(organizationId: string, approvalId: string) {
  const [row] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, organizationId),
    eq(toolApprovalsRuntime.approvalId, approvalId),
  )).limit(1);
  if (!row) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
  return {
    ...row,
    encryptedArguments: undefined,
    argumentsSummary: row.encryptedArguments
      ? redactedArgumentSummary(JSON.parse(decryptSecret(row.encryptedArguments)))
      : {},
  };
}

export async function decideToolApproval(input: {
  organizationId: string;
  approvalId: string;
  userId: string;
  approved: boolean;
  reason?: string;
}) {
  const now = new Date();
  const result = await db().transaction(async (tx) => {
    const [current] = await tx.select().from(toolApprovalsRuntime).where(and(
      eq(toolApprovalsRuntime.organizationId, input.organizationId),
      eq(toolApprovalsRuntime.approvalId, input.approvalId),
    )).limit(1);
    if (!current) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
    if (current.status !== "pending") throw new ApiError(409, "TOOL_APPROVAL_ALREADY_DECIDED", "اتُخذ قرار لهذه الموافقة مسبقًا.");
    if (current.expiresAt <= now) {
      await tx.update(toolApprovalsRuntime).set({ status: "expired", updatedAt: now }).where(eq(toolApprovalsRuntime.id, current.id));
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        actorType: "user",
        actorId: input.userId,
        action: "tool_approval.expired",
        resourceType: "tool_approval",
        resourceId: current.id,
        metadata: { runId: current.runId, toolId: current.toolId },
      });
      throw new ApiError(409, "TOOL_APPROVAL_EXPIRED", "انتهت صلاحية طلب الموافقة.");
    }
    const status = input.approved ? "approved" as const : "rejected" as const;
    const [updated] = await tx.update(toolApprovalsRuntime).set({
      status,
      decidedByUserId: input.userId,
      decidedAt: now,
      reason: input.reason?.trim() || current.reason,
      updatedAt: now,
    }).where(and(
      eq(toolApprovalsRuntime.id, current.id),
      eq(toolApprovalsRuntime.status, "pending"),
    )).returning();
    if (!updated) throw new ApiError(409, "TOOL_APPROVAL_ALREADY_DECIDED", "اتُخذ قرار لهذه الموافقة مسبقًا.");
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: input.approved ? "tool_approval.approved" : "tool_approval.rejected",
      resourceType: "tool_approval",
      resourceId: updated.id,
      metadata: { runId: updated.runId, toolId: updated.toolId, toolCallId: updated.toolCallId },
    });
    return updated;
  });
  if (result.runId) {
    await appendRunEvent({
      organizationId: input.organizationId,
      runId: result.runId,
      type: "approval.resolved",
      payload: { approvalId: result.approvalId, approved: input.approved, toolCallId: result.toolCallId },
    });
  }
  return result;
}

export async function consumeToolApproval(input: {
  organizationId: string;
  approvalId: string;
}) {
  const now = new Date();
  const [updated] = await db().update(toolApprovalsRuntime).set({
    status: "consumed",
    consumedAt: now,
    updatedAt: now,
  }).where(and(
    eq(toolApprovalsRuntime.organizationId, input.organizationId),
    eq(toolApprovalsRuntime.approvalId, input.approvalId),
    eq(toolApprovalsRuntime.status, "approved"),
  )).returning();
  if (!updated) throw new ApiError(409, "TOOL_APPROVAL_NOT_CONSUMABLE", "لا يمكن استهلاك قرار الموافقة الحالي.");
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "system",
    action: "tool_approval.consumed",
    resourceType: "tool_approval",
    resourceId: updated.id,
    metadata: { runId: updated.runId, toolId: updated.toolId, toolCallId: updated.toolCallId },
  });
  return updated;
}
