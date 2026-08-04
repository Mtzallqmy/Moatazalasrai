import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export async function recordAuditEvent(input: {
  organizationId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db().insert(auditLogs).values({
    organizationId: input.organizationId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function recordDeniedAccess(input: {
  organizationId?: string | null;
  actorId?: string | null;
  permission?: string;
  reason: string;
  requestId?: string;
  route?: string;
}) {
  await recordAuditEvent({
    organizationId: input.organizationId,
    actorType: input.actorId ? "user" : "anonymous",
    actorId: input.actorId,
    action: "security.access.denied",
    resourceType: "authorization",
    resourceId: input.permission ?? input.route ?? null,
    metadata: {
      permission: input.permission ?? null,
      reason: input.reason,
      requestId: input.requestId ?? null,
      route: input.route ?? null,
    },
  }).catch(() => undefined);
}
