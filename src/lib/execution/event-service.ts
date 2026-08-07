import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { executionEvents, executionJobs } from "@/db/execution-schema";
import type { ExecutionEventType } from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";

const forbiddenKey = /(?:secret|token|password|authorization|cookie|database_url|api[_-]?key|private[_-]?key|file[_-]?content|prompt)/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length <= 4_096 ? value : `${value.slice(0, 4_093)}...`;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !forbiddenKey.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, safeValue(item, depth + 1)]));
  }
  return String(value).slice(0, 500);
}

export function sanitizeExecutionEventPayload(payload: Record<string, unknown>) {
  return safeValue(payload) as Record<string, unknown>;
}

export function safeOutputChunk(chunk: Uint8Array, maximumBytes = 32 * 1024) {
  const kept = chunk.byteLength > maximumBytes ? chunk.slice(0, maximumBytes) : chunk;
  return {
    text: decoder.decode(kept),
    bytes: kept.byteLength,
    originalBytes: chunk.byteLength,
    truncated: chunk.byteLength > kept.byteLength,
  };
}

export async function appendExecutionEvent(input: {
  organizationId: string;
  jobId: string;
  type: ExecutionEventType;
  source: string;
  level?: "debug" | "info" | "warn" | "error";
  payload?: Record<string, unknown>;
}) {
  return db().transaction(async (tx) => {
    const [job] = await tx.select({ id: executionJobs.id }).from(executionJobs).where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, input.organizationId),
    )).for("update").limit(1);
    if (!job) throw new ExecutionError("EXECUTION_NOT_FOUND", "عملية التنفيذ غير موجودة.");
    const [next] = await tx.select({
      value: sql<number>`coalesce(max(${executionEvents.sequence}), 0) + 1`,
    }).from(executionEvents).where(eq(executionEvents.jobId, input.jobId));
    const [event] = await tx.insert(executionEvents).values({
      jobId: input.jobId,
      sequence: Number(next?.value ?? 1),
      eventType: input.type,
      source: input.source,
      level: input.level ?? "info",
      payload: sanitizeExecutionEventPayload(input.payload ?? {}),
    }).returning();
    return event;
  });
}

export async function appendOutputEvent(input: {
  organizationId: string;
  jobId: string;
  stream: "stdout" | "stderr";
  chunk: Uint8Array;
}) {
  const output = safeOutputChunk(input.chunk);
  if (encoder.encode(output.text).byteLength === 0) return null;
  return appendExecutionEvent({
    organizationId: input.organizationId,
    jobId: input.jobId,
    type: input.stream === "stdout" ? "stdout.chunk" : "stderr.chunk",
    source: "runner",
    level: input.stream === "stderr" ? "warn" : "info",
    payload: output,
  });
}

export function listExecutionEvents(input: {
  organizationId: string;
  jobId: string;
  after?: number;
  limit?: number;
}) {
  return db().select({
    id: executionEvents.id,
    sequence: executionEvents.sequence,
    type: executionEvents.eventType,
    source: executionEvents.source,
    level: executionEvents.level,
    payload: executionEvents.payload,
    createdAt: executionEvents.createdAt,
  }).from(executionEvents)
    .innerJoin(executionJobs, eq(executionJobs.id, executionEvents.jobId))
    .where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, input.organizationId),
      gt(executionEvents.sequence, input.after ?? 0),
    ))
    .orderBy(asc(executionEvents.sequence))
    .limit(Math.min(Math.max(input.limit ?? 200, 1), 500));
}
