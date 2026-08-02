import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { sandboxEvents, sandboxExecutions } from "@/db/sandbox-schema";
import { ApiError } from "@/lib/http/api";
import { redactSandboxText } from "@/lib/sandbox/policy";

export type SandboxEventInput = {
  organizationId: string;
  executionId: string;
  type: string;
  stream?: "stdout" | "stderr";
  payload?: Record<string, unknown>;
};

function sanitizePayload(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => {
    if (typeof value === "string") return [key, redactSandboxText(value, 64 * 1024)];
    return [key, value];
  }));
}

export async function appendSandboxEvent(input: SandboxEventInput) {
  return db().transaction(async (tx) => {
    const [execution] = await tx.select({ id: sandboxExecutions.id })
      .from(sandboxExecutions)
      .where(and(
        eq(sandboxExecutions.id, input.executionId),
        eq(sandboxExecutions.organizationId, input.organizationId),
      ))
      .for("update")
      .limit(1);
    if (!execution) throw new ApiError(404, "SANDBOX_EXECUTION_NOT_FOUND", "عملية Sandbox غير موجودة.");
    const [last] = await tx.select({ sequence: max(sandboxEvents.sequence) })
      .from(sandboxEvents)
      .where(eq(sandboxEvents.executionId, input.executionId));
    const sequence = Number(last?.sequence ?? 0) + 1;
    const [created] = await tx.insert(sandboxEvents).values({
      organizationId: input.organizationId,
      executionId: input.executionId,
      sequence,
      type: input.type.slice(0, 100),
      stream: input.stream,
      payload: sanitizePayload(input.payload ?? {}),
    }).returning();
    if (!created) throw new Error("SANDBOX_EVENT_CREATE_FAILED");
    return created;
  });
}

export async function appendSandboxEvents(input: {
  organizationId: string;
  executionId: string;
  events: Array<{ type: string; stream?: "stdout" | "stderr"; payload?: Record<string, unknown>; runnerSequence?: number }>;
}) {
  for (const event of input.events) {
    await appendSandboxEvent({
      organizationId: input.organizationId,
      executionId: input.executionId,
      type: event.type,
      stream: event.stream,
      payload: { ...event.payload, ...(event.runnerSequence ? { runnerSequence: event.runnerSequence } : {}) },
    });
  }
}

export async function listSandboxEvents(input: {
  organizationId: string;
  executionId: string;
  after?: number;
  limit?: number;
}) {
  const after = Math.max(0, input.after ?? 0);
  const limit = Math.min(500, Math.max(1, input.limit ?? 200));
  const rows = await db().select({
    sequence: sandboxEvents.sequence,
    type: sandboxEvents.type,
    stream: sandboxEvents.stream,
    payload: sandboxEvents.payload,
    createdAt: sandboxEvents.createdAt,
  }).from(sandboxEvents).where(and(
    eq(sandboxEvents.organizationId, input.organizationId),
    eq(sandboxEvents.executionId, input.executionId),
    sql`${sandboxEvents.sequence} > ${after}`,
  )).orderBy(sandboxEvents.sequence).limit(limit);
  return rows;
}
