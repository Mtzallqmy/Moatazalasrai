import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import {
  agents,
  auditLogs,
  mcpServers,
  mcpTools,
  runs,
} from "@/db/schema";
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
      encryptedArguments: encryptSecret(JSON.stringify(input.arguments), `approval:${input.organizationId}:${input.runId}`),
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

async function expirePendingApprovals(organizationId: string) {
  const now = new Date();
  const expired = await db().update(toolApprovalsRuntime).set({
    status: "expired",
    updatedAt: now,
  }).where(and(
    eq(toolApprovalsRuntime.organizationId, organizationId),
    eq(toolApprovalsRuntime.status, "pending"),
    lte(toolApprovalsRuntime.expiresAt, now),
  )).returning({
    id: toolApprovalsRuntime.id,
    runId: toolApprovalsRuntime.runId,
    toolId: toolApprovalsRuntime.toolId,
    browserTaskId: toolApprovalsRuntime.browserTaskId,
    sandboxExecutionId: toolApprovalsRuntime.sandboxExecutionId,
  });
  if (expired.length) {
    await db().insert(auditLogs).values(expired.map((row) => ({
      organizationId,
      actorType: "system" as const,
      action: "tool_approval.expired",
      resourceType: "tool_approval",
      resourceId: row.id,
      metadata: {
        runId: row.runId,
        toolId: row.toolId,
        browserTaskId: row.browserTaskId,
        sandboxExecutionId: row.sandboxExecutionId,
      },
    })));
  }
}

function approvalEncryptionContext(row: typeof toolApprovalsRuntime.$inferSelect) {
  return row.runId
    ? `approval:${row.organizationId}:${row.runId}`
    : `approval:${row.organizationId}:external:${row.approvalId}`;
}

function publicApproval(row: typeof toolApprovalsRuntime.$inferSelect) {
  return {
    ...row,
    encryptedArguments: undefined,
    argumentsSummary: row.encryptedArguments
      ? redactedArgumentSummary(JSON.parse(decryptSecret(row.encryptedArguments, approvalEncryptionContext(row))))
      : {},
  };
}

function externalToolPresentation(row: typeof toolApprovalsRuntime.$inferSelect) {
  if (row.toolId.startsWith("sandbox.")) {
    return {
      toolName: ({
        "sandbox.exec": "تنفيذ أمر في Sandbox",
        "sandbox.writeFile": "كتابة ملف في Sandbox",
        "sandbox.deleteFile": "حذف ملف من Sandbox",
        "sandbox.reset": "إعادة ضبط Sandbox",
        "sandbox.downloadArtifact": "تنزيل ملف من Sandbox",
      } as Record<string, string>)[row.toolId] ?? "عملية Sandbox",
      serverName: "بيئة Sandbox المعزولة",
    };
  }
  if (row.toolId.startsWith("browser.")) {
    return { toolName: "إجراء داخل موقع خارجي", serverName: "متصفح الوكيل" };
  }
  return null;
}

async function hydrateApprovals(
  organizationId: string,
  rows: Array<typeof toolApprovalsRuntime.$inferSelect>,
) {
  if (rows.length === 0) return [];
  const toolIds = [...new Set(rows.map((row) => row.toolId).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))];
  const serverIds = [...new Set(rows.map((row) => row.serverId).filter((value): value is string => Boolean(value)))];
  const agentIds = [...new Set(rows.map((row) => row.agentId).filter((value): value is string => Boolean(value)))];
  const [tools, servers, agentRows] = await Promise.all([
    toolIds.length ? db().select({ id: mcpTools.id, name: mcpTools.name, title: mcpTools.title })
      .from(mcpTools).where(and(eq(mcpTools.organizationId, organizationId), inArray(mcpTools.id, toolIds))) : Promise.resolve([]),
    serverIds.length ? db().select({ id: mcpServers.id, name: mcpServers.name })
      .from(mcpServers).where(and(eq(mcpServers.organizationId, organizationId), inArray(mcpServers.id, serverIds))) : Promise.resolve([]),
    agentIds.length ? db().select({ id: agents.id, name: agents.name })
      .from(agents).where(and(eq(agents.organizationId, organizationId), inArray(agents.id, agentIds))) : Promise.resolve([]),
  ]);
  const toolById = new Map(tools.map((row) => [row.id, row]));
  const serverById = new Map(servers.map((row) => [row.id, row]));
  const agentById = new Map(agentRows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const external = externalToolPresentation(row);
    const tool = toolById.get(row.toolId);
    return {
      ...publicApproval(row),
      toolName: external?.toolName ?? tool?.title ?? tool?.name ?? "أداة MCP",
      serverName: external?.serverName ?? (row.serverId ? serverById.get(row.serverId)?.name ?? "خادم MCP" : "خادم MCP"),
      agentName: row.agentId ? agentById.get(row.agentId)?.name ?? "وكيل" : "مستخدم",
    };
  });
}

export async function listPendingToolApprovals(organizationId: string) {
  await expirePendingApprovals(organizationId);
  const rows = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, organizationId),
    eq(toolApprovalsRuntime.status, "pending"),
    gt(toolApprovalsRuntime.expiresAt, new Date()),
  )).orderBy(desc(toolApprovalsRuntime.createdAt));
  return hydrateApprovals(organizationId, rows);
}

export async function getToolApproval(organizationId: string, approvalId: string) {
  await expirePendingApprovals(organizationId);
  const [row] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, organizationId),
    eq(toolApprovalsRuntime.approvalId, approvalId),
  )).limit(1);
  if (!row) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
  const [hydrated] = await hydrateApprovals(organizationId, [row]);
  return hydrated!;
}

export async function getToolApprovalForResume(organizationId: string, approvalId: string) {
  const [row] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, organizationId),
    eq(toolApprovalsRuntime.approvalId, approvalId),
  )).limit(1);
  if (!row) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
  if (!row.runId || !row.toolCallId) throw new ApiError(409, "TOOL_APPROVAL_INVALID", "طلب الموافقة غير مرتبط بتشغيل صالح.");
  if (row.status !== "approved" && row.status !== "rejected") {
    throw new ApiError(409, "TOOL_APPROVAL_NOT_DECIDED", "لم يُتخذ قرار صالح لهذه الموافقة.");
  }
  return row;
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
      await tx.update(toolApprovalsRuntime).set({ status: "expired", updatedAt: now })
        .where(eq(toolApprovalsRuntime.id, current.id));
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        actorType: "user",
        actorId: input.userId,
        action: "tool_approval.expired",
        resourceType: "tool_approval",
        resourceId: current.id,
        metadata: { runId: current.runId, toolId: current.toolId },
      });
      return { kind: "expired" as const, approval: current };
    }
    const status = input.approved ? "approved" as const : "rejected" as const;
    const [updated] = await tx.update(toolApprovalsRuntime).set({
      status,
      decidedByUserId: input.userId,
      decidedAt: now,
      reason: input.reason?.trim() || current.reason,
      updatedAt: now,
    }).where(and(eq(toolApprovalsRuntime.id, current.id), eq(toolApprovalsRuntime.status, "pending"))).returning();
    if (!updated) throw new ApiError(409, "TOOL_APPROVAL_ALREADY_DECIDED", "اتُخذ قرار لهذه الموافقة مسبقًا.");
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: input.approved ? "tool_approval.approved" : "tool_approval.rejected",
      resourceType: "tool_approval",
      resourceId: updated.id,
      metadata: {
        runId: updated.runId,
        toolId: updated.toolId,
        toolCallId: updated.toolCallId,
        browserTaskId: updated.browserTaskId,
        sandboxExecutionId: updated.sandboxExecutionId,
      },
    });
    return { kind: "decided" as const, approval: updated };
  });
  if (result.kind === "expired") {
    throw new ApiError(409, "TOOL_APPROVAL_EXPIRED", "انتهت صلاحية طلب الموافقة.");
  }
  const approval = result.approval;
  if (approval.runId) {
    await appendRunEvent({
      organizationId: input.organizationId,
      runId: approval.runId,
      type: "approval.resolved",
      payload: { approvalId: approval.approvalId, approved: input.approved, toolCallId: approval.toolCallId },
    });
  }
  return approval;
}

export async function consumeToolApproval(input: { organizationId: string; approvalId: string }) {
  const now = new Date();
  const [updated] = await db().update(toolApprovalsRuntime).set({
    status: "consumed",
    consumedAt: now,
    updatedAt: now,
  }).where(and(
    eq(toolApprovalsRuntime.organizationId, input.organizationId),
    eq(toolApprovalsRuntime.approvalId, input.approvalId),
    inArray(toolApprovalsRuntime.status, ["approved", "rejected"]),
  )).returning();
  if (!updated) throw new ApiError(409, "TOOL_APPROVAL_NOT_CONSUMABLE", "لا يمكن استهلاك قرار الموافقة الحالي.");
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "system",
    action: "tool_approval.consumed",
    resourceType: "tool_approval",
    resourceId: updated.id,
    metadata: {
      runId: updated.runId,
      toolId: updated.toolId,
      toolCallId: updated.toolCallId,
      browserTaskId: updated.browserTaskId,
      sandboxExecutionId: updated.sandboxExecutionId,
    },
  });
  return updated;
}
