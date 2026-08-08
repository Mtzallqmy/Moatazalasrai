import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { executionEvents, executionJobs } from "@/db/execution-schema";
import { auditLogs } from "@/db/schema";
import { enqueueExecutionTaskTx, type ExecutionActor } from "@/lib/execution/repository";
import { TERMINAL_EXECUTION_STATUSES } from "@/lib/execution/states";
import { ExecutionError } from "@/lib/execution/errors";

export async function requestExecutionCancellation(input: {
  actor: ExecutionActor;
  jobId: string;
  requestId: string;
}) {
  return db().transaction(async (tx) => {
    const [job] = await tx.select().from(executionJobs).where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, input.actor.organizationId),
      input.actor.role === "member" ? eq(executionJobs.userId, input.actor.userId) : undefined,
    )).for("update").limit(1);
    if (!job) throw new ExecutionError("EXECUTION_NOT_FOUND", "عملية التنفيذ غير موجودة.");
    if (TERMINAL_EXECUTION_STATUSES.has(job.status)) return { job, accepted: false, terminal: true };
    if (job.status === "cancel_requested" || job.status === "cancelling") {
      return { job, accepted: true, terminal: false };
    }

    const now = new Date();
    const [updated] = await tx.update(executionJobs).set({
      status: "cancel_requested",
      cancelRequestedAt: job.cancelRequestedAt ?? now,
      updatedAt: now,
    }).where(and(
      eq(executionJobs.id, job.id),
      eq(executionJobs.organizationId, input.actor.organizationId),
      inArray(executionJobs.status, [
        "queued", "provisioning", "ready", "running", "waiting_for_input", "waiting_for_approval", "orphaned",
      ]),
    )).returning();
    if (!updated) throw new ExecutionError("EXECUTION_INVALID_TRANSITION", "تعذر تثبيت طلب الإلغاء.");
    const [sequence] = await tx.select({
      value: sql<number>`coalesce(max(${executionEvents.sequence}), 0) + 1`,
    }).from(executionEvents).where(eq(executionEvents.jobId, job.id));
    await tx.insert(executionEvents).values({
      jobId: job.id,
      sequence: Number(sequence?.value ?? 1),
      eventType: "cancel.requested",
      source: "api",
      level: "warn",
      payload: { requestId: input.requestId },
    });
    await enqueueExecutionTaskTx(tx, {
      task: "execution-cancel",
      payload: { organizationId: input.actor.organizationId, jobId: job.id },
      queueName: "execution-cleanup",
      jobKey: `execution:cancel:${job.id}`,
      maxAttempts: 5,
      priority: -10,
    });
    await tx.insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "execution.cancel_requested",
      resourceType: "execution_job",
      resourceId: job.id,
      metadata: { requestId: input.requestId, previousStatus: job.status },
    });
    return { job: updated, accepted: true, terminal: false };
  });
}
