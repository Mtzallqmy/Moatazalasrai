import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import { auditLogs } from "@/db/schema";
import { toolApprovalTtlSeconds } from "@/lib/ai-sdk/limits";
import { encryptSecret } from "@/lib/security/encryption";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export async function requestExternalToolApproval(input: {
  organizationId: string;
  requestedByUserId?: string | null;
  agentId?: string | null;
  toolId: string;
  arguments: Record<string, unknown>;
  reason: string;
  risk: string;
  capability: string;
  actionSnapshot: Record<string, unknown>;
  browserTaskId?: string;
  browserTaskStepId?: string;
  sandboxExecutionId?: string;
}) {
  const identity = input.browserTaskStepId
    ? { column: toolApprovalsRuntime.browserTaskStepId, value: input.browserTaskStepId }
    : input.sandboxExecutionId
      ? { column: toolApprovalsRuntime.sandboxExecutionId, value: input.sandboxExecutionId }
      : null;
  if (identity) {
    const [existing] = await db().select().from(toolApprovalsRuntime).where(and(
      eq(toolApprovalsRuntime.organizationId, input.organizationId),
      eq(identity.column, identity.value),
    )).limit(1);
    if (existing) return existing;
  }

  const approvalId = randomUUID();
  const expiresAt = new Date(Date.now() + toolApprovalTtlSeconds() * 1000);
  return db().transaction(async (tx) => {
    const [created] = await tx.insert(toolApprovalsRuntime).values({
      organizationId: input.organizationId,
      toolId: input.toolId,
      inputDigest: digest(input.arguments),
      status: "pending",
      requestedByUserId: input.requestedByUserId,
      expiresAt,
      approvalId,
      agentId: input.agentId,
      encryptedArguments: encryptSecret(
        JSON.stringify(input.arguments),
        `approval:${input.organizationId}:external:${approvalId}`,
      ),
      reason: input.reason,
      risk: input.risk,
      capability: input.capability,
      browserTaskId: input.browserTaskId,
      browserTaskStepId: input.browserTaskStepId,
      sandboxExecutionId: input.sandboxExecutionId,
      actionSnapshot: input.actionSnapshot,
    }).returning();
    if (!created) throw new Error("EXTERNAL_TOOL_APPROVAL_CREATE_FAILED");
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: input.agentId ? "agent" : "user",
      actorId: input.agentId ?? input.requestedByUserId,
      action: "tool_approval.requested",
      resourceType: "tool_approval",
      resourceId: created.id,
      metadata: {
        approvalId,
        toolId: input.toolId,
        risk: input.risk,
        capability: input.capability,
        browserTaskId: input.browserTaskId ?? null,
        browserTaskStepId: input.browserTaskStepId ?? null,
        sandboxExecutionId: input.sandboxExecutionId ?? null,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return created;
  });
}
