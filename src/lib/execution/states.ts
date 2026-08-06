import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { executionArtifacts, executionEvents, executionJobs, executionSteps } from "@/db/execution-schema";
import type { ExecutionStatus } from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";
import type { ExecutionTransaction } from "@/lib/execution/repository";

export const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

const transitions: Record<ExecutionStatus, ReadonlySet<ExecutionStatus>> = {
  queued: new Set(["provisioning", "cancel_requested", "failed", "timed_out"]),
  provisioning: new Set(["ready", "cancel_requested", "failed", "timed_out", "orphaned"]),
  ready: new Set(["running", "cancel_requested", "failed", "timed_out", "orphaned"]),
  running: new Set(["waiting_for_input", "waiting_for_approval", "cancel_requested", "completed", "failed", "timed_out", "orphaned"]),
  waiting_for_input: new Set(["running", "cancel_requested", "failed", "timed_out", "orphaned"]),
  waiting_for_approval: new Set(["running", "cancel_requested", "failed", "timed_out", "orphaned"]),
  cancel_requested: new Set(["cancelling", "cancelled", "failed", "orphaned"]),
  cancelling: new Set(["cancelled", "failed", "orphaned"]),
  orphaned: new Set(["provisioning", "ready", "running", "cancel_requested", "failed", "timed_out", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  timed_out: new Set(),
  cancelled: new Set(),
};

export function canTransitionExecutionStatus(current: ExecutionStatus, next: ExecutionStatus) {
  return transitions[current].has(next);
}

function transitionEvent(status: ExecutionStatus) {
  const events: Partial<Record<ExecutionStatus, string>> = {
    queued: "job.queued",
    provisioning: "workspace.provisioning",
    ready: "workspace.ready",
    running: "process.started",
    waiting_for_input: "input.required",
    waiting_for_approval: "approval.required",
    cancel_requested: "cancel.requested",
    cancelling: "process.terminated",
    completed: "job.completed",
    failed: "job.failed",
    timed_out: "job.timed_out",
    cancelled: "job.cancelled",
    orphaned: "job.failed",
  };
  return events[status] ?? "job.failed";
}

async function assertCompletionEvidence(tx: ExecutionTransaction, job: typeof executionJobs.$inferSelect) {
  const [incomplete] = await tx.select({ value: count() }).from(executionSteps).where(and(
    eq(executionSteps.jobId, job.id),
    ne(executionSteps.status, "completed"),
  ));
  if ((incomplete?.value ?? 0) > 0) {
    throw new ExecutionError("EXECUTION_INVALID_TRANSITION", "لا يمكن إكمال التنفيذ قبل اكتمال جميع الخطوات.");
  }
  const summary = job.resultSummary ?? {};
  if (summary.executionVerified !== true) {
    throw new ExecutionError("EXECUTION_INVALID_TRANSITION", "لا يمكن إكمال التنفيذ دون دليل تنفيذ موثق.");
  }
  const requiredArtifacts = typeof summary.requiredArtifactCount === "number" ? summary.requiredArtifactCount : 0;
  if (requiredArtifacts > 0) {
    const [artifacts] = await tx.select({ value: count() }).from(executionArtifacts).where(eq(executionArtifacts.jobId, job.id));
    if ((artifacts?.value ?? 0) < requiredArtifacts) {
      throw new ExecutionError("EXECUTION_INVALID_TRANSITION", "لا يمكن إكمال التنفيذ قبل تخزين النتائج المطلوبة.");
    }
  }
}

export async function transitionExecutionStatus(input: {
  organizationId: string;
  jobId: string;
  expectedStatus: ExecutionStatus | ExecutionStatus[];
  nextStatus: ExecutionStatus;
  source: string;
  level?: "debug" | "info" | "warn" | "error";
  payload?: Record<string, unknown>;
  patch?: Partial<Pick<typeof executionJobs.$inferInsert,
    "errorCode" | "errorReference" | "resultSummary" | "startedAt" | "completedAt" | "attemptCount" | "cancelRequestedAt">>;
}) {
  const expected = Array.isArray(input.expectedStatus) ? input.expectedStatus : [input.expectedStatus];
  return db().transaction(async (tx) => {
    const [job] = await tx.select().from(executionJobs).where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, input.organizationId),
    )).for("update").limit(1);
    if (!job) throw new ExecutionError("EXECUTION_NOT_FOUND", "عملية التنفيذ غير موجودة.");
    if (TERMINAL_EXECUTION_STATUSES.has(job.status)) {
      if (job.status === input.nextStatus) return job;
      throw new ExecutionError("EXECUTION_TERMINAL", "عملية التنفيذ وصلت إلى حالة نهائية.");
    }
    if (!expected.includes(job.status)) {
      throw new ExecutionError("EXECUTION_INVALID_TRANSITION", "تغيرت حالة التنفيذ قبل إتمام العملية المطلوبة.", false, {
        expected,
        current: job.status,
        next: input.nextStatus,
      });
    }
    if (!canTransitionExecutionStatus(job.status, input.nextStatus)) {
      throw new ExecutionError("EXECUTION_INVALID_TRANSITION", "انتقال حالة التنفيذ غير مسموح.", false, {
        current: job.status,
        next: input.nextStatus,
      });
    }
    if (input.nextStatus === "completed") await assertCompletionEvidence(tx, job);

    const now = new Date();
    const [updated] = await tx.update(executionJobs).set({
      status: input.nextStatus,
      updatedAt: now,
      ...(input.nextStatus === "running" && !job.startedAt ? { startedAt: now } : {}),
      ...(TERMINAL_EXECUTION_STATUSES.has(input.nextStatus) ? { completedAt: now } : {}),
      ...input.patch,
    }).where(and(
      eq(executionJobs.id, job.id),
      eq(executionJobs.organizationId, input.organizationId),
      inArray(executionJobs.status, expected),
    )).returning();
    if (!updated) throw new ExecutionError("EXECUTION_INVALID_TRANSITION", "تعذر تثبيت انتقال حالة التنفيذ.");

    const [sequence] = await tx.select({
      value: sql<number>`coalesce(max(${executionEvents.sequence}), 0) + 1`,
    }).from(executionEvents).where(eq(executionEvents.jobId, job.id));
    await tx.insert(executionEvents).values({
      jobId: job.id,
      sequence: Number(sequence?.value ?? 1),
      eventType: transitionEvent(input.nextStatus),
      source: input.source,
      level: input.level ?? (input.nextStatus === "failed" ? "error" : "info"),
      payload: { from: job.status, to: input.nextStatus, ...(input.payload ?? {}) },
    });
    return updated;
  });
}
