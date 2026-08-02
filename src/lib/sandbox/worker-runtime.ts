import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import {
  sandboxExecutions,
  sandboxWorkspaces,
} from "@/db/sandbox-schema";
import { auditLogs } from "@/db/schema";
import { consumeToolApproval } from "@/lib/ai-sdk/approvals";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import { appendSandboxEvent, appendSandboxEvents } from "@/lib/sandbox/events";
import {
  createRunnerWorkspace,
  deleteRunnerWorkspace,
  getRunnerExecution,
  resetRunnerWorkspace,
  startRunnerExecution,
  stopRunnerExecution,
} from "@/lib/sandbox/runner-client";
import { decryptSecret } from "@/lib/security/encryption";

const terminalStatuses = new Set(["completed", "failed", "cancelled", "timed_out"]);

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function provisionSandboxWorkspace(input: { organizationId: string; workspaceId: string }) {
  const [workspace] = await db().select().from(sandboxWorkspaces).where(and(
    eq(sandboxWorkspaces.id, input.workspaceId),
    eq(sandboxWorkspaces.organizationId, input.organizationId),
  )).limit(1);
  if (!workspace) throw new ApiError(404, "SANDBOX_WORKSPACE_NOT_FOUND", "مساحة Sandbox غير موجودة.");
  if (workspace.status === "ready" && workspace.externalWorkspaceId) return workspace;
  if (workspace.status === "terminated") return workspace;
  try {
    const result = await createRunnerWorkspace({
      tenantId: input.organizationId,
      workspaceId: workspace.id,
      template: workspace.template,
      diskLimitBytes: workspace.diskLimitBytes,
      networkMode: workspace.networkMode,
    });
    const [updated] = await db().update(sandboxWorkspaces).set({
      externalWorkspaceId: result.workspaceId,
      status: result.status,
      errorCode: null,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(sandboxWorkspaces.id, workspace.id),
      eq(sandboxWorkspaces.organizationId, input.organizationId),
    )).returning();
    await db().insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "system",
      action: "sandbox.workspace_ready",
      resourceType: "sandbox_workspace",
      resourceId: workspace.id,
      metadata: { provider: workspace.provider, template: workspace.template },
    });
    return updated ?? workspace;
  } catch (error) {
    await db().update(sandboxWorkspaces).set({ status: "failed", errorCode: "SANDBOX_PROVISION_FAILED", updatedAt: new Date() }).where(and(
      eq(sandboxWorkspaces.id, workspace.id),
      eq(sandboxWorkspaces.organizationId, input.organizationId),
    ));
    throw error;
  }
}

export async function executeSandboxExecution(input: { organizationId: string; executionId: string }) {
  const claimed = await db().transaction(async (tx) => {
    const [execution] = await tx.select().from(sandboxExecutions).where(and(
      eq(sandboxExecutions.id, input.executionId),
      eq(sandboxExecutions.organizationId, input.organizationId),
    )).for("update").limit(1);
    if (!execution) throw new ApiError(404, "SANDBOX_EXECUTION_NOT_FOUND", "عملية Sandbox غير موجودة.");
    if (terminalStatuses.has(execution.status)) return { execution, claimed: false as const };
    if (execution.status === "awaiting_approval") return { execution, claimed: false as const };
    if (execution.cancelRequestedAt) {
      const [cancelled] = await tx.update(sandboxExecutions).set({
        status: "cancelled",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sandboxExecutions.id, execution.id)).returning();
      return { execution: cancelled ?? execution, claimed: false as const };
    }
    const [workspace] = await tx.select().from(sandboxWorkspaces).where(and(
      eq(sandboxWorkspaces.id, execution.workspaceId),
      eq(sandboxWorkspaces.organizationId, input.organizationId),
    )).limit(1);
    if (!workspace || workspace.status !== "ready" || !workspace.externalWorkspaceId) {
      throw new ApiError(409, "SANDBOX_WORKSPACE_NOT_READY", "مساحة Sandbox ليست جاهزة للتنفيذ.");
    }
    const [running] = await tx.update(sandboxExecutions).set({
      status: "running",
      startedAt: execution.startedAt ?? new Date(),
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(sandboxExecutions.id, execution.id),
      inArray(sandboxExecutions.status, ["queued", "running"]),
    )).returning();
    return { execution: running ?? execution, workspace, claimed: true as const };
  });
  if (!claimed.claimed) return claimed.execution;

  const { execution, workspace } = claimed;
  const command = decryptSecret(
    execution.encryptedCommand,
    `sandbox-command:${input.organizationId}:${execution.id}`,
  );
  const started = await startRunnerExecution({
    tenantId: input.organizationId,
    workspaceId: workspace.externalWorkspaceId!,
    executionId: execution.externalExecutionId ?? execution.id,
    command,
    workingDirectory: execution.workingDirectory,
    timeoutMs: execution.timeoutMs,
    maxOutputBytes: env().sandboxMaxOutputBytes,
  });
  await db().update(sandboxExecutions).set({
    externalExecutionId: started.executionId,
    updatedAt: new Date(),
  }).where(and(
    eq(sandboxExecutions.id, execution.id),
    eq(sandboxExecutions.organizationId, input.organizationId),
  ));
  await appendSandboxEvent({
    organizationId: input.organizationId,
    executionId: execution.id,
    type: "status",
    payload: { status: "running" },
  });

  let runnerSequence = 0;
  const deadline = Date.now() + execution.timeoutMs + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await getRunnerExecution({
      tenantId: input.organizationId,
      externalWorkspaceId: workspace.externalWorkspaceId!,
      externalExecutionId: started.executionId,
      after: runnerSequence,
    });
    const fresh = snapshot.events.filter((event) => event.sequence > runnerSequence);
    if (fresh.length) {
      runnerSequence = Math.max(runnerSequence, ...fresh.map((event) => event.sequence));
      await appendSandboxEvents({
        organizationId: input.organizationId,
        executionId: execution.id,
        events: fresh.map((event) => ({
          type: event.type,
          stream: event.stream,
          payload: event.payload,
          runnerSequence: event.sequence,
        })),
      });
    }
    await db().update(sandboxExecutions).set({
      stdoutBytes: snapshot.stdoutBytes,
      stderrBytes: snapshot.stderrBytes,
      outputTruncated: snapshot.outputTruncated,
      updatedAt: new Date(),
    }).where(and(
      eq(sandboxExecutions.id, execution.id),
      eq(sandboxExecutions.organizationId, input.organizationId),
    ));

    const [state] = await db().select({ cancelRequestedAt: sandboxExecutions.cancelRequestedAt })
      .from(sandboxExecutions).where(and(
        eq(sandboxExecutions.id, execution.id),
        eq(sandboxExecutions.organizationId, input.organizationId),
      )).limit(1);
    if (state?.cancelRequestedAt && snapshot.status === "running") {
      await stopRunnerExecution({
        tenantId: input.organizationId,
        externalWorkspaceId: workspace.externalWorkspaceId!,
        externalExecutionId: started.executionId,
      });
    }

    if (snapshot.status !== "running") {
      const platformStatus = snapshot.status;
      const now = new Date();
      const [updated] = await db().update(sandboxExecutions).set({
        status: platformStatus,
        exitCode: snapshot.exitCode,
        stdoutBytes: snapshot.stdoutBytes,
        stderrBytes: snapshot.stderrBytes,
        outputTruncated: snapshot.outputTruncated,
        completedAt: snapshot.completedAt ? new Date(snapshot.completedAt) : now,
        errorCode: platformStatus === "failed" ? "SANDBOX_COMMAND_FAILED" : null,
        errorMessage: null,
        updatedAt: now,
      }).where(and(
        eq(sandboxExecutions.id, execution.id),
        eq(sandboxExecutions.organizationId, input.organizationId),
      )).returning();
      await db().insert(auditLogs).values({
        organizationId: input.organizationId,
        actorType: "system",
        action: `sandbox.execution_${platformStatus}`,
        resourceType: "sandbox_execution",
        resourceId: execution.id,
        metadata: {
          workspaceId: workspace.id,
          exitCode: snapshot.exitCode,
          stdoutBytes: snapshot.stdoutBytes,
          stderrBytes: snapshot.stderrBytes,
          outputTruncated: snapshot.outputTruncated,
        },
      });
      return updated ?? execution;
    }
    await sleep(350);
  }

  await stopRunnerExecution({
    tenantId: input.organizationId,
    externalWorkspaceId: workspace.externalWorkspaceId!,
    externalExecutionId: started.executionId,
  }).catch(() => undefined);
  const [timedOut] = await db().update(sandboxExecutions).set({
    status: "timed_out",
    completedAt: new Date(),
    errorCode: "SANDBOX_EXECUTION_TIMEOUT",
    updatedAt: new Date(),
  }).where(and(
    eq(sandboxExecutions.id, execution.id),
    eq(sandboxExecutions.organizationId, input.organizationId),
  )).returning();
  return timedOut ?? execution;
}

export async function resumeSandboxExecution(input: {
  organizationId: string;
  approvalId: string;
  executionId: string;
}) {
  const [approval] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, input.organizationId),
    eq(toolApprovalsRuntime.approvalId, input.approvalId),
    eq(toolApprovalsRuntime.sandboxExecutionId, input.executionId),
  )).limit(1);
  if (!approval) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
  if (approval.status !== "approved" && approval.status !== "rejected") {
    throw new ApiError(409, "TOOL_APPROVAL_NOT_DECIDED", "لم يُتخذ قرار صالح لهذه الموافقة.");
  }
  if (approval.status === "rejected") {
    const [rejected] = await db().update(sandboxExecutions).set({
      status: "failed",
      errorCode: "SANDBOX_APPROVAL_REJECTED",
      errorMessage: "رفض المستخدم تنفيذ الأمر.",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(sandboxExecutions.id, input.executionId),
      eq(sandboxExecutions.organizationId, input.organizationId),
      eq(sandboxExecutions.status, "awaiting_approval"),
    )).returning();
    await consumeToolApproval({ organizationId: input.organizationId, approvalId: input.approvalId });
    return rejected;
  }
  await db().update(sandboxExecutions).set({ status: "queued", updatedAt: new Date() }).where(and(
    eq(sandboxExecutions.id, input.executionId),
    eq(sandboxExecutions.organizationId, input.organizationId),
    eq(sandboxExecutions.status, "awaiting_approval"),
  ));
  await consumeToolApproval({ organizationId: input.organizationId, approvalId: input.approvalId });
  return executeSandboxExecution({ organizationId: input.organizationId, executionId: input.executionId });
}

export async function resetSandboxWorkspaceRuntime(input: { organizationId: string; workspaceId: string }) {
  const [workspace] = await db().select().from(sandboxWorkspaces).where(and(
    eq(sandboxWorkspaces.id, input.workspaceId),
    eq(sandboxWorkspaces.organizationId, input.organizationId),
  )).limit(1);
  if (!workspace || !workspace.externalWorkspaceId) throw new ApiError(404, "SANDBOX_WORKSPACE_NOT_FOUND", "مساحة Sandbox غير موجودة.");
  const result = await resetRunnerWorkspace({ tenantId: input.organizationId, externalWorkspaceId: workspace.externalWorkspaceId });
  const [updated] = await db().update(sandboxWorkspaces).set({
    status: result.status,
    errorCode: null,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(sandboxWorkspaces.id, workspace.id),
    eq(sandboxWorkspaces.organizationId, input.organizationId),
  )).returning();
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "system",
    action: "sandbox.workspace_reset",
    resourceType: "sandbox_workspace",
    resourceId: workspace.id,
    metadata: {},
  });
  return updated;
}

export async function cleanupSandboxWorkspaces(input: { organizationId?: string }) {
  const now = new Date();
  const rows = await db().select().from(sandboxWorkspaces).where(and(
    input.organizationId ? eq(sandboxWorkspaces.organizationId, input.organizationId) : undefined,
    orTerminalOrExpired(now),
  )).limit(100);
  for (const workspace of rows) {
    if (workspace.externalWorkspaceId) {
      await deleteRunnerWorkspace({ tenantId: workspace.organizationId, externalWorkspaceId: workspace.externalWorkspaceId }).catch(() => undefined);
    }
    await db().update(sandboxWorkspaces).set({ status: "terminated", updatedAt: now }).where(and(
      eq(sandboxWorkspaces.id, workspace.id),
      eq(sandboxWorkspaces.organizationId, workspace.organizationId),
    ));
  }
  return { cleaned: rows.length };
}

function orTerminalOrExpired(now: Date) {
  return and(
    isNotNull(sandboxWorkspaces.expiresAt),
    lte(sandboxWorkspaces.expiresAt, now),
    inArray(sandboxWorkspaces.status, ["ready", "paused", "failed", "terminated"]),
  );
}
