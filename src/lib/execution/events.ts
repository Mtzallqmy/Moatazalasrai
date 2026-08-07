import { and, asc, eq, gt, max } from "drizzle-orm";
import { db } from "@/db";
import { executionEvents, executionJobs } from "@/db/execution-schema";
import { ApiError } from "@/lib/http/api";

export async function appendExecutionEvent(input: {
  organizationId: string;
  executionJobId: string;
  type: string;
  payload?: Record<string, unknown>;
}) {
  return db().transaction(async (tx) => {
    const [job] = await tx.select({ id: executionJobs.id }).from(executionJobs).where(and(
      eq(executionJobs.id, input.executionJobId),
      eq(executionJobs.organizationId, input.organizationId),
    )).for("update").limit(1);
    if (!job) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
    const [latest] = await tx.select({ value: max(executionEvents.sequence) }).from(executionEvents).where(and(
      eq(executionEvents.organizationId, input.organizationId),
      eq(executionEvents.executionJobId, input.executionJobId),
    ));
    const sequence = (latest?.value ?? 0) + 1;
    const [created] = await tx.insert(executionEvents).values({
      organizationId: input.organizationId,
      executionJobId: input.executionJobId,
      sequence,
      type: input.type.slice(0, 120),
      payload: input.payload ?? {},
    }).returning();
    if (!created) throw new Error("EXECUTION_EVENT_CREATE_FAILED");
    return created;
  });
}

export function listExecutionEvents(input: {
  organizationId: string;
  executionJobId: string;
  after?: number;
  limit?: number;
}) {
  return db().select().from(executionEvents).where(and(
    eq(executionEvents.organizationId, input.organizationId),
    eq(executionEvents.executionJobId, input.executionJobId),
    input.after ? gt(executionEvents.sequence, input.after) : undefined,
  )).orderBy(asc(executionEvents.sequence)).limit(Math.min(500, Math.max(1, input.limit ?? 100)));
}
