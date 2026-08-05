import { and, asc, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { domainEvents } from "@/db/control-plane-schema";
import { enqueueNotificationDispatch } from "@/worker/queue";

export async function recoverPendingDomainEvents(input: { limit?: number; olderThanMs?: number } = {}) {
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1_000));
  const olderThan = new Date(Date.now() - Math.max(input.olderThanMs ?? 60_000, 10_000));
  const pending = await db().select({
    id: domainEvents.id,
    organizationId: domainEvents.organizationId,
  }).from(domainEvents).where(and(
    isNull(domainEvents.processedAt),
    lt(domainEvents.createdAt, olderThan),
  )).orderBy(asc(domainEvents.createdAt)).limit(limit);

  const results = await Promise.allSettled(pending.map((event) => enqueueNotificationDispatch({
    organizationId: event.organizationId,
    eventId: event.id,
  })));
  return {
    scanned: pending.length,
    enqueued: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}
