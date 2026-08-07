import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import { browserTaskSteps } from "@/db/site-connections-schema";
import { browserAgentSessions, toolRunApprovals, toolRuns } from "@/db/tool-run-schema";
import { artifactRegistry } from "@/lib/execution/artifact-registry";
import { appendExecutionEvent } from "@/lib/execution/events";
import { markExecutionStatus } from "@/lib/execution/service";
import { createBrowserTask, getBrowserTask } from "@/lib/browser/task-service";
import { ApiError } from "@/lib/http/api";
import type { ToolHandlerContext } from "@/lib/tools/contracts";
import { enqueueBrowserTask, enqueueExecutionRun } from "@/worker/queue";

const configSchema = z.object({
  agentId: z.string().uuid(),
  connectionId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(4_000),
  startUrl: z.string().url().max(2_000).optional(),
  browserTaskId: z.string().uuid().optional(),
}).strict();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mirrorPendingApproval(context: ToolHandlerContext, browserTaskId: string) {
  const [approval] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, context.actor.organizationId),
    eq(toolApprovalsRuntime.browserTaskId, browserTaskId),
    eq(toolApprovalsRuntime.status, "pending"),
  )).limit(1);
  if (!approval) return null;
  const [existing] = await db().select().from(toolRunApprovals).where(and(
    eq(toolRunApprovals.organizationId, context.actor.organizationId),
    eq(toolRunApprovals.toolRunId, context.toolRunId),
    eq(toolRunApprovals.status, "pending"),
  )).limit(1);
  if (existing) return existing;
  const [created] = await db().insert(toolRunApprovals).values({
    organizationId: context.actor.organizationId,
    toolRunId: context.toolRunId,
    actionType: approval.toolId,
    riskLevel: approval.risk ?? "high",
    requestedPayload: {
      externalApprovalId: approval.approvalId,
      browserTaskId,
      capability: approval.capability ?? null,
      reason: approval.reason ?? null,
    },
    status: "pending",
    expiresAt: approval.expiresAt,
  }).returning();
  return created ?? null;
}

async function exportBrowserDownloads(context: ToolHandlerContext, browserTaskId: string) {
  const steps = await db().select({ result: browserTaskSteps.result, sequence: browserTaskSteps.sequence }).from(browserTaskSteps).where(and(
    eq(browserTaskSteps.organizationId, context.actor.organizationId),
    eq(browserTaskSteps.browserTaskId, browserTaskId),
  ));
  const artifactIds: string[] = [];
  for (const step of steps) {
    const download = step.result?.download;
    if (!download || typeof download !== "object" || Array.isArray(download)) continue;
    const attachmentId = (download as Record<string, unknown>).attachmentId;
    if (typeof attachmentId !== "string") continue;
    const artifact = await artifactRegistry.registerAttachment({
      organizationId: context.actor.organizationId,
      executionJobId: context.executionJobId,
      attachmentId,
      kind: "browser_download",
      metadata: { browserTaskId, step: step.sequence },
    });
    artifactIds.push(artifact.id);
  }
  return artifactIds;
}

export async function runBrowserAgent(context: ToolHandlerContext) {
  const [run] = await db().select().from(toolRuns).where(and(
    eq(toolRuns.id, context.toolRunId),
    eq(toolRuns.organizationId, context.actor.organizationId),
    eq(toolRuns.userId, context.actor.userId),
  )).limit(1);
  if (!run) throw new ApiError(404, "TOOL_RUN_NOT_FOUND", "تشغيل الأداة غير موجود.");
  const config = configSchema.parse(run.configuration);

  let browserTaskId = config.browserTaskId;
  if (!browserTaskId) {
    const created = await createBrowserTask({
      organizationId: context.actor.organizationId,
      userId: context.actor.userId,
      requestId: `tool-run:${context.toolRunId}`,
      body: {
        agentId: config.agentId,
        connectionId: config.connectionId,
        instruction: config.instruction,
        idempotencyKey: `tool-run:${context.toolRunId}`,
      },
    });
    browserTaskId = created.id;
    await db().update(toolRuns).set({ configuration: { ...config, browserTaskId }, status: "running", updatedAt: new Date() }).where(eq(toolRuns.id, context.toolRunId));
    await db().insert(browserAgentSessions).values({
      organizationId: context.actor.organizationId,
      userId: context.actor.userId,
      toolRunId: context.toolRunId,
      startUrl: config.startUrl ?? "about:blank",
      allowedHosts: [],
      state: { browserTaskId },
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000),
    }).onConflictDoUpdate({
      target: [browserAgentSessions.organizationId, browserAgentSessions.toolRunId],
      set: { state: { browserTaskId }, updatedAt: new Date() },
    });
  }

  await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId, status: "running" });
  await appendExecutionEvent({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId, type: "browser.task", payload: { browserTaskId } });

  let task = await getBrowserTask({
    organizationId: context.actor.organizationId,
    userId: context.actor.userId,
    role: context.actor.role,
    browserTaskId,
  });
  if (["queued", "planning", "running"].includes(task.status)) {
    await enqueueBrowserTask({ organizationId: context.actor.organizationId, browserTaskId });
  }

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    task = await getBrowserTask({
      organizationId: context.actor.organizationId,
      userId: context.actor.userId,
      role: context.actor.role,
      browserTaskId,
    });
    if (task.status === "awaiting_approval") {
      const approval = await mirrorPendingApproval(context, browserTaskId);
      await db().update(toolRuns).set({ status: "waiting_for_approval", updatedAt: new Date() }).where(eq(toolRuns.id, context.toolRunId));
      await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId, status: "waiting_for_approval", result: approval ? { approvalId: approval.id, browserTaskId } : { browserTaskId } });
      return;
    }
    if (task.status === "awaiting_connection") {
      await db().update(toolRuns).set({ status: "waiting_for_input", resultSummary: { reason: "browser_connection_required", browserTaskId }, updatedAt: new Date() }).where(eq(toolRuns.id, context.toolRunId));
      await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId, status: "waiting_for_input", result: { reason: "browser_connection_required" } });
      return;
    }
    if (["completed", "failed", "cancelled", "expired"].includes(task.status)) break;
    await sleep(750);
  }

  task = await getBrowserTask({ organizationId: context.actor.organizationId, userId: context.actor.userId, role: context.actor.role, browserTaskId });
  if (!["completed", "failed", "cancelled", "expired"].includes(task.status)) {
    await appendExecutionEvent({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId, type: "browser.progress", payload: { status: task.status, currentStep: task.currentStep } });
    await enqueueExecutionRun({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId }, new Date(Date.now() + 5_000));
    return;
  }
  if (task.status !== "completed") {
    const status = task.status === "cancelled" ? "cancelled" : "failed";
    await db().update(toolRuns).set({ status, errorCode: task.errorCode ?? `BROWSER_${task.status.toUpperCase()}`, errorReference: crypto.randomUUID(), completedAt: new Date(), updatedAt: new Date() }).where(eq(toolRuns.id, context.toolRunId));
    await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId, status, errorCode: task.errorCode ?? `BROWSER_${task.status.toUpperCase()}` });
    return;
  }
  const artifactIds = await exportBrowserDownloads(context, browserTaskId);
  const summary = { browserTaskId, status: task.status, currentStep: task.currentStep, plan: task.plan ?? null, artifactIds };
  await db().update(toolRuns).set({ status: "completed", resultSummary: summary, completedAt: new Date(), updatedAt: new Date() }).where(eq(toolRuns.id, context.toolRunId));
  await markExecutionStatus({ organizationId: context.actor.organizationId, executionJobId: context.executionJobId, status: "completed", result: summary });
}
