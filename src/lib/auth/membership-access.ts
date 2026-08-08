import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { mobileSessions, organizationMembers, sessions } from "@/db/schema";
import { runWithSystemDatabaseContext } from "@/db/tenant-context";

export function activeMembership(at = new Date()) {
  return or(isNull(organizationMembers.expiresAt), gt(organizationMembers.expiresAt, at));
}

export function accessExpiry(value: Date | string | null | undefined) {
  if (!value) return null;
  const expiresAt = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(expiresAt.getTime())) throw new Error("MEMBERSHIP_EXPIRY_INVALID");
  return expiresAt;
}

export async function revokeOrganizationSessions(userId: string, organizationId: string) {
  const now = new Date();
  await runWithSystemDatabaseContext(() => Promise.all([
    db().update(sessions).set({ revokedAt: now }).where(and(
      eq(sessions.userId, userId),
      eq(sessions.activeOrganizationId, organizationId),
      isNull(sessions.revokedAt),
    )),
    db().update(mobileSessions).set({ revokedAt: now, updatedAt: now }).where(and(
      eq(mobileSessions.userId, userId),
      eq(mobileSessions.organizationId, organizationId),
      isNull(mobileSessions.revokedAt),
    )),
  ]));
}
