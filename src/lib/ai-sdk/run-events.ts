import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { withDatabaseQuerySubsystem } from "@/db/query-observability";
import { databaseRows } from "@/db/result";
import { runEvents, runs } from "@/db/schema";
import { ApiError } from "@/lib/http/api";

export async function appendRunEvents(input: {
  organizationId: string;
  runId: string;
  events: Array<{ type: string; payload?: Record<string, unknown> }>;
}) {
  if (input.events.length === 0) return [];
  return withDatabaseQuerySubsystem("run_events", () => db().transaction(async (tx) => {
    const lock = await tx.execute(sql`
      SELECT "id" FROM "runs"
      WHERE "id" = ${input.runId} AND "organization_id" = ${input.organizationId}
      FOR UPDATE
    `);
    if (databaseRows(lock).length === 0) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
    const [current] = await tx.select({ sequence: max(runEvents.sequence) }).from(runEvents)
      .innerJoin(runs, eq(runs.id, runEvents.runId))
      .where(and(eq(runEvents.runId, input.runId), eq(runs.organizationId, input.organizationId)));
    const start = (current?.sequence ?? 0) + 1;
    return tx.insert(runEvents).values(input.events.map((event, index) => ({
      runId: input.runId,
      sequence: start + index,
      type: event.type,
      payload: event.payload ?? {},
    }))).returning();
  }));
}

export async function appendRunEvent(input: {
  organizationId: string;
  runId: string;
  type: string;
  payload?: Record<string, unknown>;
}) {
  const [event] = await appendRunEvents({
    organizationId: input.organizationId,
    runId: input.runId,
    events: [{ type: input.type, payload: input.payload }],
  });
  return event;
}
