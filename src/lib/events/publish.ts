import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { domainEvents } from "@/db/control-plane-schema";
import { enqueueNotificationDispatch } from "@/worker/queue";

export async function publishDomainEvent(input: {
  organizationId: string;
  eventKey: string;
  actorType?: string;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  occurredAt?: Date;
}) {
  const values = {
    organizationId: input.organizationId,
    eventKey: input.eventKey,
    actorType: input.actorType ?? "system",
    actorId: input.actorId ?? null,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    payload: input.payload ?? {},
    idempotencyKey: input.idempotencyKey ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  };

  let [event] = await db().insert(domainEvents).values(values).onConflictDoNothing().returning();
  if (!event && input.idempotencyKey) {
    [event] = await db().select().from(domainEvents).where(and(
      eq(domainEvents.organizationId, input.organizationId),
      eq(domainEvents.idempotencyKey, input.idempotencyKey),
    )).limit(1);
  }
  if (!event) throw new Error("DOMAIN_EVENT_CREATE_FAILED");
  await enqueueNotificationDispatch({ organizationId: input.organizationId, eventId: event.id });
  return event;
}
