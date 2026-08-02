import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import { browserTasksRuntime } from "@/db/browser-runtime-schema";
import { browserTaskSteps } from "@/db/site-connections-schema";
import { auditLogs } from "@/db/schema";
import { consumeToolApproval } from "@/lib/ai-sdk/approvals";
import { browserPlanSchema } from "@/lib/browser/contracts";
import { executeBrowserRunnerStep, getBrowserRunnerTask } from "@/lib/browser/runner-client";
import { executeBrowserTaskRuntime } from "@/lib/browser/worker-runtime";
import { ApiError } from "@/lib/http/api";
import { decryptSecret } from "@/lib/security/encryption";

function redactedResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value };
  const result = { ...(value as Record<string, unknown>) };
  if (result.download && typeof result.download === "object") {
    const download = result.download as Record<string, unknown>;
    result.download = {
      filename: typeof download.filename === "string" ? download.filename : "download",
      sizeBytes: typeof download.sizeBytes === "number" ? download.sizeBytes : null,
      omitted: true,
    };
  }
  return result;
}

export async function resumeBrowserTaskAfterApproval(input: {
  organizationId: string;
  approvalId: string;
  browserTaskId: string;
}) {
  const [approval] = await db().select().from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.organizationId, input.organizationId),
    eq(toolApprovalsRuntime.approvalId, input.approvalId),
    eq(toolApprovalsRuntime.browserTaskId, input.browserTaskId),
  )).limit(1);
  if (!approval?.browserTaskStepId) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
  if (approval.status !== "approved" && approval.status !== "rejected") {
    throw new ApiError(409, "TOOL_APPROVAL_NOT_DECIDED", "لم يُتخذ قرار صالح لهذه الموافقة.");
  }
  const [task] = await db().select().from(browserTasksRuntime).where(and(
    eq(browserTasksRuntime.id, input.browserTaskId),
    eq(browserTasksRuntime.organizationId, input.organizationId),
  )).limit(1);
  if (!task) throw new ApiError(404, "BROWSER_TASK_NOT_FOUND", "مهمة المتصفح غير موجودة.");
  const [stepRow] = await db().select().from(browserTaskSteps).where(and(
    eq(browserTaskSteps.id, approval.browserTaskStepId),
    eq(browserTaskSteps.organizationId, input.organizationId),
    eq(browserTaskSteps.browserTaskId, task.id),
  )).limit(1);
  if (!stepRow) throw new ApiError(404, "BROWSER_TASK_STEP_MISSING", "خطوة مهمة المتصفح غير متاحة.");

  if (approval.status === "rejected") {
    const now = new Date();
    const failed = await db().transaction(async (tx) => {
      await tx.update(browserTaskSteps).set({
        status: "failed",
        result: { errorCode: "BROWSER_APPROVAL_REJECTED" },
        completedAt: now,
      }).where(eq(browserTaskSteps.id, stepRow.id));
      const [row] = await tx.update(browserTasksRuntime).set({
        status: "failed",
        errorCode: "BROWSER_APPROVAL_REJECTED",
        errorMessage: "رفض المستخدم تنفيذ الخطوة.",
        completedAt: now,
        updatedAt: now,
      }).where(eq(browserTasksRuntime.id, task.id)).returning();
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        actorType: "user",
        actorId: approval.decidedByUserId,
        action: "browser_task.approval_rejected",
        resourceType: "browser_task",
        resourceId: task.id,
        metadata: { stepId: stepRow.id, approvalId: approval.approvalId },
      });
      return row;
    });
    await consumeToolApproval({ organizationId: input.organizationId, approvalId: input.approvalId });
    return failed ?? task;
  }

  if (!task.externalTaskId || !task.encryptedPlan) {
    throw new ApiError(409, "BROWSER_SESSION_EXPIRED", "انتهت جلسة تنفيذ المتصفح ولا يمكن إعادة الخطوات السابقة بأمان.");
  }
  const runner = await getBrowserRunnerTask({
    tenantId: input.organizationId,
    taskId: task.externalTaskId,
    after: task.runnerEventSequence,
  });
  if (runner.status !== "running" || runner.currentStep !== task.currentStep) {
    throw new ApiError(409, "BROWSER_SESSION_EXPIRED", "انتهت جلسة التنفيذ أو لم تعد مطابقة لنقطة الاستئناف.");
  }
  const plan = browserPlanSchema.parse(JSON.parse(decryptSecret(
    task.encryptedPlan,
    `browser-plan:${input.organizationId}:${task.id}`,
  )));
  const step = plan.steps[task.currentStep];
  if (!step || stepRow.sequence !== task.currentStep) {
    throw new ApiError(409, "BROWSER_RESUME_STEP_MISMATCH", "خطوة الموافقة لا تطابق نقطة الاستئناف الحالية.");
  }

  await db().update(browserTaskSteps).set({ status: "running", startedAt: new Date() })
    .where(eq(browserTaskSteps.id, stepRow.id));
  const executed = await executeBrowserRunnerStep({
    tenantId: input.organizationId,
    taskId: task.externalTaskId,
    stepIndex: task.currentStep,
  });
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(browserTaskSteps).set({
      status: "completed",
      result: { ...redactedResult(executed.result), approvedOnce: true },
      completedAt: now,
    }).where(eq(browserTaskSteps.id, stepRow.id));
    await tx.update(browserTasksRuntime).set({
      status: "running",
      currentStep: task.currentStep + 1,
      runnerEventSequence: task.runnerEventSequence + 1,
      updatedAt: now,
    }).where(eq(browserTasksRuntime.id, task.id));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "agent",
      actorId: task.agentId,
      action: "browser_task.approved_step_completed",
      resourceType: "browser_task",
      resourceId: task.id,
      metadata: {
        stepId: step.id,
        approvalId: approval.approvalId,
        action: step.action,
        permission: step.requiredPermission,
      },
    });
  });
  await consumeToolApproval({ organizationId: input.organizationId, approvalId: input.approvalId });
  return executeBrowserTaskRuntime({ organizationId: input.organizationId, browserTaskId: input.browserTaskId });
}
