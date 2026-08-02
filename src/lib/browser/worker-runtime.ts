import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import { browserTasksRuntime } from "@/db/browser-runtime-schema";
import {
  browserTaskSteps,
  siteConnections,
} from "@/db/site-connections-schema";
import { attachments, auditLogs } from "@/db/schema";
import { consumeToolApproval } from "@/lib/ai-sdk/approvals";
import { requestExternalToolApproval } from "@/lib/ai-sdk/external-approvals";
import { browserPlanSchema, type BrowserPlanStep } from "@/lib/browser/contracts";
import { createBrowserPlan } from "@/lib/browser/planner";
import {
  cancelBrowserRunnerTask,
  executeBrowserRunnerStep,
  getBrowserRunnerState,
  getBrowserRunnerTask,
  startBrowserRunnerTask,
} from "@/lib/browser/runner-client";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import { resolveAgentSitePermission } from "@/lib/site-connections/service";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { readAttachmentContent, storeAttachment } from "@/lib/storage/attachments";

function redactedStepInput(step: BrowserPlanStep) {
  return {
    ...(step.value === undefined ? {} : { valueProvided: true, valueLength: step.value.length }),
    ...(step.option === undefined ? {} : { optionProvided: true }),
    ...(step.fileArtifactId === undefined ? {} : { fileArtifactId: step.fileArtifactId }),
  };
}

function safeStepResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value };
  const result = { ...(value as Record<string, unknown>) };
  if (result.download && typeof result.download === "object") {
    result.download = { ...(result.download as Record<string, unknown>), contentBase64: undefined };
  }
  return result;
}

function downloadMime(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".zip")) return "application/zip";
  throw new ApiError(415, "BROWSER_DOWNLOAD_TYPE_UNSUPPORTED", "نوع الملف الناتج غير مدعوم للتخزين الآمن.");
}

async function uploadArtifacts(input: { organizationId: string; plan: ReturnType<typeof browserPlanSchema.parse> }) {
  const ids = [...new Set(input.plan.steps.map((step) => step.fileArtifactId).filter((value): value is string => Boolean(value)))];
  const artifacts: Record<string, { filename: string; mimeType: string; contentBase64: string }> = {};
  for (const id of ids) {
    const [file] = await db().select().from(attachments).where(and(
      eq(attachments.id, id),
      eq(attachments.organizationId, input.organizationId),
    )).limit(1);
    if (!file || file.deletedAt || file.archivedAt) {
      throw new ApiError(404, "BROWSER_UPLOAD_FILE_NOT_FOUND", "ملف الرفع المحدد غير موجود.");
    }
    const content = Buffer.from(await readAttachmentContent(file));
    if (content.length > env().browserAllowedDownloadBytes) {
      throw new ApiError(413, "BROWSER_UPLOAD_FILE_TOO_LARGE", "ملف الرفع أكبر من الحد المسموح.");
    }
    artifacts[id] = { filename: file.filename, mimeType: file.mimeType, contentBase64: content.toString("base64") };
  }
  return artifacts;
}

async function prepareBrowserTask(input: { organizationId: string; browserTaskId: string }) {
  const [task] = await db().select().from(browserTasksRuntime).where(and(
    eq(browserTasksRuntime.id, input.browserTaskId),
    eq(browserTasksRuntime.organizationId, input.organizationId),
  )).limit(1);
  if (!task) throw new ApiError(404, "BROWSER_TASK_NOT_FOUND", "مهمة المتصفح غير موجودة.");
  if (task.encryptedPlan) return task;
  if (["completed", "failed", "cancelled", "expired"].includes(task.status)) return task;

  const [connection] = await db().select({
    id: siteConnections.id,
    siteDomain: siteConnections.siteDomain,
    status: siteConnections.status,
    allowedDomains: siteConnections.allowedDomains,
    encryptedSessionState: siteConnections.encryptedSessionState,
  }).from(siteConnections).where(and(
    eq(siteConnections.id, task.siteConnectionId),
    eq(siteConnections.organizationId, input.organizationId),
  )).limit(1);
  if (!connection || connection.status !== "verified" || !connection.encryptedSessionState) {
    await db().update(browserTasksRuntime).set({ status: "awaiting_connection", updatedAt: new Date() }).where(eq(browserTasksRuntime.id, task.id));
    return { ...task, status: "awaiting_connection" as const };
  }

  await db().update(browserTasksRuntime).set({ status: "planning", updatedAt: new Date() }).where(and(
    eq(browserTasksRuntime.id, task.id),
    eq(browserTasksRuntime.organizationId, input.organizationId),
  ));
  const planned = await createBrowserPlan({
    organizationId: input.organizationId,
    agentId: task.agentId,
    connectionId: connection.id,
    siteDomain: connection.siteDomain,
    allowedDomains: connection.allowedDomains,
    instruction: task.instruction,
    requestId: `browser-plan:${task.id}`,
  });
  const encryptedPlan = encryptSecret(
    JSON.stringify(planned.plan),
    `browser-plan:${input.organizationId}:${task.id}`,
  );
  const updated = await db().transaction(async (tx) => {
    const [row] = await tx.update(browserTasksRuntime).set({
      status: "running",
      riskLevel: planned.riskLevel,
      plan: planned.publicPlan,
      encryptedPlan,
      startedAt: task.startedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(browserTasksRuntime.id, task.id),
      eq(browserTasksRuntime.organizationId, input.organizationId),
    )).returning();
    await tx.insert(browserTaskSteps).values(planned.plan.steps.map((step, index) => ({
      organizationId: input.organizationId,
      browserTaskId: task.id,
      sequence: index,
      action: step.action,
      target: step.target ?? (step.url ? { url: step.url } : {}),
      inputRedacted: redactedStepInput(step),
      requiredPermission: step.requiredPermission,
      riskLevel: step.risk,
      status: "queued",
      expectedResult: step.expectedResult,
    }))).onConflictDoNothing({ target: [browserTaskSteps.browserTaskId, browserTaskSteps.sequence] });
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "agent",
      actorId: task.agentId,
      action: "browser_task.planned",
      resourceType: "browser_task",
      resourceId: task.id,
      metadata: { stepCount: planned.plan.steps.length, riskLevel: planned.riskLevel },
    });
    return row ?? task;
  });
  return updated;
}

export async function executeBrowserTaskRuntime(input: { organizationId: string; browserTaskId: string }) {
  let task = await prepareBrowserTask(input);
  if (["awaiting_connection", "completed", "failed", "cancelled", "expired", "awaiting_approval"].includes(task.status)) return task;
  if (!task.encryptedPlan) throw new ApiError(500, "BROWSER_PLAN_MISSING", "خطة مهمة المتصفح غير متاحة.");
  const plan = browserPlanSchema.parse(JSON.parse(decryptSecret(
    task.encryptedPlan,
    `browser-plan:${input.organizationId}:${task.id}`,
  )));
  const [connection] = await db().select().from(siteConnections).where(and(
    eq(siteConnections.id, task.siteConnectionId),
    eq(siteConnections.organizationId, input.organizationId),
    eq(siteConnections.status, "verified"),
  )).limit(1);
  if (!connection?.encryptedSessionState) throw new ApiError(409, "BROWSER_SESSION_MISSING", "جلسة المتصفح غير متاحة.");
  const storageState = JSON.parse(decryptSecret(
    connection.encryptedSessionState,
    `browser-session:${input.organizationId}:${connection.id}`,
  )) as Record<string, unknown>;

  if (!task.externalTaskId) {
    const started = await startBrowserRunnerTask({
      tenantId: input.organizationId,
      taskId: task.id,
      storageState,
      plan,
      allowedDomains: connection.allowedDomains,
      maxPages: env().browserMaxPages,
      timeoutMs: env().browserTaskTimeoutMs,
      maxDownloadBytes: env().browserAllowedDownloadBytes,
      artifacts: await uploadArtifacts({ organizationId: input.organizationId, plan }),
    });
    const [updated] = await db().update(browserTasksRuntime).set({
      externalTaskId: started.taskId,
      status: "running",
      updatedAt: new Date(),
    }).where(and(eq(browserTasksRuntime.id, task.id), eq(browserTasksRuntime.organizationId, input.organizationId))).returning();
    task = updated ?? task;
  }

  while (task.currentStep < plan.steps.length) {
    const [fresh] = await db().select().from(browserTasksRuntime).where(and(
      eq(browserTasksRuntime.id, task.id),
      eq(browserTasksRuntime.organizationId, input.organizationId),
    )).limit(1);
    if (!fresh) throw new ApiError(404, "BROWSER_TASK_NOT_FOUND", "مهمة المتصفح غير موجودة.");
    task = fresh;
    if (task.cancelRequestedAt || task.status === "cancelled") {
      await cancelBrowserRunnerTask({ tenantId: input.organizationId, taskId: task.externalTaskId! }).catch(() => undefined);
      return task;
    }
    const step = plan.steps[task.currentStep]!;
    const [stepRow] = await db().select().from(browserTaskSteps).where(and(
      eq(browserTaskSteps.organizationId, input.organizationId),
      eq(browserTaskSteps.browserTaskId, task.id),
      eq(browserTaskSteps.sequence, task.currentStep),
    )).limit(1);
    if (!stepRow) throw new ApiError(500, "BROWSER_TASK_STEP_MISSING", "خطوة مهمة المتصفح غير متاحة.");

    const decision = await resolveAgentSitePermission({
      organizationId: input.organizationId,
      agentId: task.agentId,
      connectionId: task.siteConnectionId,
      action: step.requiredPermission,
      risk: step.risk,
    });
    if (decision.outcome === "deny") {
      const now = new Date();
      await db().transaction(async (tx) => {
        await tx.update(browserTaskSteps).set({ status: "failed", result: { errorCode: "SITE_ACTION_DENIED" }, completedAt: now })
          .where(eq(browserTaskSteps.id, stepRow.id));
        await tx.update(browserTasksRuntime).set({ status: "failed", errorCode: "SITE_ACTION_DENIED", errorMessage: "سياسة الاتصال تمنع الخطوة.", completedAt: now, updatedAt: now })
          .where(eq(browserTasksRuntime.id, task.id));
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          actorType: "agent",
          actorId: task.agentId,
          action: "browser_task.step_denied",
          resourceType: "browser_task",
          resourceId: task.id,
          metadata: { stepId: step.id, action: step.action, permission: step.requiredPermission, risk: step.risk },
        });
      });
      return { ...task, status: "failed" as const };
    }
    if (decision.outcome === "require_approval") {
      const existing = await db().select().from(toolApprovalsRuntime).where(and(
        eq(toolApprovalsRuntime.organizationId, input.organizationId),
        eq(toolApprovalsRuntime.browserTaskStepId, stepRow.id),
      )).limit(1);
      if (existing[0]?.status === "approved") {
        // The resume worker will consume the decision and continue.
        return { ...task, status: "awaiting_approval" as const };
      }
      if (!existing[0]) {
        await requestExternalToolApproval({
          organizationId: input.organizationId,
          requestedByUserId: task.userId,
          agentId: task.agentId,
          toolId: `browser.${step.action}`,
          arguments: {
            stepId: step.id,
            action: step.action,
            target: step.target ?? null,
            url: step.url ?? null,
            value: step.value ?? null,
            option: step.option ?? null,
          },
          reason: `الخطوة تتطلب صلاحية ${step.requiredPermission} بمستوى خطورة ${step.risk}.`,
          risk: step.risk,
          capability: step.requiredPermission,
          actionSnapshot: {
            siteDomain: connection.siteDomain,
            stepId: step.id,
            action: step.action,
            target: step.target ?? null,
            expectedResult: step.expectedResult,
            sendsData: step.value !== undefined || step.option !== undefined || step.fileArtifactId !== undefined,
          },
          browserTaskId: task.id,
          browserTaskStepId: stepRow.id,
        });
      }
      await db().transaction(async (tx) => {
        await tx.update(browserTaskSteps).set({ status: "awaiting_approval" }).where(eq(browserTaskSteps.id, stepRow.id));
        await tx.update(browserTasksRuntime).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(browserTasksRuntime.id, task.id));
      });
      return { ...task, status: "awaiting_approval" as const };
    }

    await db().update(browserTaskSteps).set({ status: "running", startedAt: new Date() }).where(eq(browserTaskSteps.id, stepRow.id));
    try {
      const executed = await executeBrowserRunnerStep({
        tenantId: input.organizationId,
        taskId: task.externalTaskId!,
        stepIndex: task.currentStep,
      });
      let result = safeStepResult(executed.result);
      const download = executed.result && typeof executed.result === "object" && "download" in executed.result
        ? (executed.result as { download?: { filename?: string; contentBase64?: string } }).download
        : undefined;
      if (download?.filename && download.contentBase64) {
        const content = Buffer.from(download.contentBase64, "base64");
        const stored = await storeAttachment({
          organizationId: input.organizationId,
          uploadedByUserId: task.userId ?? undefined,
          source: "web",
          filename: download.filename,
          mimeType: downloadMime(download.filename),
          content,
        });
        result = { ...result, download: { filename: stored.filename, sizeBytes: stored.sizeBytes, attachmentId: stored.id } };
      }
      const now = new Date();
      const [updated] = await db().transaction(async (tx) => {
        await tx.update(browserTaskSteps).set({ status: "completed", result, completedAt: now }).where(eq(browserTaskSteps.id, stepRow.id));
        const [row] = await tx.update(browserTasksRuntime).set({
          currentStep: task.currentStep + 1,
          runnerEventSequence: task.runnerEventSequence + 1,
          status: "running",
          updatedAt: now,
        }).where(eq(browserTasksRuntime.id, task.id)).returning();
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          actorType: "agent",
          actorId: task.agentId,
          action: "browser_task.step_completed",
          resourceType: "browser_task",
          resourceId: task.id,
          metadata: {
            stepId: step.id,
            action: step.action,
            permission: step.requiredPermission,
            risk: step.risk,
            durationMs: executed.durationMs ?? null,
          },
        });
        return row;
      });
      task = updated ?? task;
    } catch (error) {
      const now = new Date();
      const code = error instanceof ApiError ? error.code : "BROWSER_STEP_FAILED";
      await db().transaction(async (tx) => {
        await tx.update(browserTaskSteps).set({ status: "failed", result: { errorCode: code }, completedAt: now }).where(eq(browserTaskSteps.id, stepRow.id));
        await tx.update(browserTasksRuntime).set({ status: "failed", errorCode: code, errorMessage: "فشل تنفيذ خطوة المتصفح.", completedAt: now, updatedAt: now }).where(eq(browserTasksRuntime.id, task.id));
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          actorType: "system",
          action: "browser_task.step_failed",
          resourceType: "browser_task",
          resourceId: task.id,
          metadata: { stepId: step.id, action: step.action, errorCode: code },
        });
      });
      await cancelBrowserRunnerTask({ tenantId: input.organizationId, taskId: task.externalTaskId! }).catch(() => undefined);
      throw error;
    }
  }

  const state = await getBrowserRunnerState({ tenantId: input.organizationId, taskId: task.externalTaskId! });
  const now = new Date();
  const [completed] = await db().transaction(async (tx) => {
    await tx.update(siteConnections).set({
      encryptedSessionState: encryptSecret(
        JSON.stringify(state.storageState),
        `browser-session:${input.organizationId}:${connection.id}`,
      ),
      lastUsedAt: now,
      updatedAt: now,
    }).where(and(eq(siteConnections.id, connection.id), eq(siteConnections.organizationId, input.organizationId)));
    const [row] = await tx.update(browserTasksRuntime).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(browserTasksRuntime.id, task.id)).returning();
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "system",
      action: "browser_task.completed",
      resourceType: "browser_task",
      resourceId: task.id,
      metadata: { stepCount: plan.steps.length, finalUrl: state.currentUrl },
    });
    return row;
  });
  await cancelBrowserRunnerTask({ tenantId: input.organizationId, taskId: task.externalTaskId! }).catch(() => undefined);
  return completed ?? task;
}

export async function resumeBrowserTaskRuntime(input: {
  organizationId: string;
  approvalId: string;
  browserTaskId: string;
}) {
  const [approval] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, input.organizationId),
    eq(toolApprovalsRuntime.approvalId, input.approvalId),
    eq(toolApprovalsRuntime.browserTaskId, input.browserTaskId),
  )).limit(1);
  if (!approval || !approval.browserTaskStepId) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
  if (approval.status !== "approved" && approval.status !== "rejected") {
    throw new ApiError(409, "TOOL_APPROVAL_NOT_DECIDED", "لم يُتخذ قرار صالح لهذه الموافقة.");
  }
  if (approval.status === "rejected") {
    const now = new Date();
    const [task] = await db().transaction(async (tx) => {
      await tx.update(browserTaskSteps).set({ status: "failed", result: { errorCode: "BROWSER_APPROVAL_REJECTED" }, completedAt: now })
        .where(eq(browserTaskSteps.id, approval.browserTaskStepId!));
      const [row] = await tx.update(browserTasksRuntime).set({ status: "failed", errorCode: "BROWSER_APPROVAL_REJECTED", errorMessage: "رفض المستخدم تنفيذ الخطوة.", completedAt: now, updatedAt: now })
        .where(and(eq(browserTasksRuntime.id, input.browserTaskId), eq(browserTasksRuntime.organizationId, input.organizationId))).returning();
      return row;
    });
    await consumeToolApproval({ organizationId: input.organizationId, approvalId: input.approvalId });
    return task;
  }
  const [task] = await db().select().from(browserTasksRuntime).where(and(
    eq(browserTasksRuntime.id, input.browserTaskId),
    eq(browserTasksRuntime.organizationId, input.organizationId),
  )).limit(1);
  if (!task?.externalTaskId) throw new ApiError(409, "BROWSER_SESSION_EXPIRED", "انتهت جلسة تنفيذ المتصفح ولا يمكن إعادة الخطوات السابقة بأمان.");
  const runner = await getBrowserRunnerTask({ tenantId: input.organizationId, taskId: task.externalTaskId, after: task.runnerEventSequence });
  if (runner.status !== "running") throw new ApiError(409, "BROWSER_SESSION_EXPIRED", "انتهت جلسة تنفيذ المتصفح ولا يمكن إعادة الخطوات السابقة بأمان.");
  await db().transaction(async (tx) => {
    await tx.update(browserTaskSteps).set({ status: "queued" }).where(eq(browserTaskSteps.id, approval.browserTaskStepId!));
    await tx.update(browserTasksRuntime).set({ status: "running", updatedAt: new Date() }).where(eq(browserTasksRuntime.id, task.id));
  });
  await consumeToolApproval({ organizationId: input.organizationId, approvalId: input.approvalId });
  return executeBrowserTaskRuntime({ organizationId: input.organizationId, browserTaskId: input.browserTaskId });
}
