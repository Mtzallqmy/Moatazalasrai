import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { organizationMembers, organizations, sessions, users } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import {
  enterUserDatabaseContext,
  runWithSystemDatabaseContext,
} from "@/lib/security/database-context";

export const SESSION_COOKIE = "moataz_session";
const SESSION_DAYS = 30;
const SESSION_IDLE_DAYS = 7;
const LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createSession(input: {
  userId: string;
  activeOrganizationId?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  enterUserDatabaseContext(input.userId, input.activeOrganizationId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const values: {
    userId: string;
    activeOrganizationId?: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  } = {
    userId: input.userId,
    tokenHash: hashToken(token),
    expiresAt,
  };

  if (input.activeOrganizationId) values.activeOrganizationId = input.activeOrganizationId;
  if (input.ipAddress) values.ipAddress = input.ipAddress;
  if (input.userAgent) values.userAgent = input.userAgent.slice(0, 500);

  await db().insert(sessions).values(values);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function revokeCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await runWithSystemDatabaseContext("revoke-current-session-by-token", () =>
      db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token))));
  }
  store.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string) {
  enterUserDatabaseContext(userId);
  await db().update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  (await cookies()).delete(SESSION_COOKIE);
}

export async function setActiveOrganization(userId: string, sessionId: string, organizationId: string) {
  enterUserDatabaseContext(userId, organizationId);
  const [membership] = await db()
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.organizationId, organizationId),
    ))
    .limit(1);
  if (!membership) throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "المؤسسة غير متاحة لهذا الحساب.");
  const nextToken = randomBytes(32).toString("base64url");
  const [rotated] = await db()
    .update(sessions)
    .set({ activeOrganizationId: organizationId, tokenHash: hashToken(nextToken), lastSeenAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ expiresAt: sessions.expiresAt });
  if (!rotated) throw new ApiError(401, "SESSION_INVALID", "انتهت الجلسة أو أُبطلت.");
  (await cookies()).set(SESSION_COOKIE, nextToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: rotated.expiresAt,
  });
}

export async function currentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [base] = await runWithSystemDatabaseContext("session-token-lookup", () => db()
    .select({
      sessionId: sessions.id,
      activeOrganizationId: sessions.activeOrganizationId,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.tokenHash, hashToken(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
      gt(sessions.lastSeenAt, new Date(Date.now() - SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000)),
    ))
    .limit(1));

  if (!base) return null;

  let activeOrganizationId = base.activeOrganizationId;
  enterUserDatabaseContext(base.userId, activeOrganizationId);
  if (!activeOrganizationId) {
    const memberships = await db()
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, base.userId))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(2);
    if (memberships.length === 1) {
      activeOrganizationId = memberships[0].organizationId;
      enterUserDatabaseContext(base.userId, activeOrganizationId);
      await db().update(sessions).set({ activeOrganizationId }).where(eq(sessions.id, base.sessionId));
    }
  }

  enterUserDatabaseContext(base.userId, activeOrganizationId);
  const [membership] = activeOrganizationId
    ? await db()
      .select({
        organizationId: organizations.id,
        organizationName: organizations.name,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(
        eq(organizationMembers.userId, base.userId),
        eq(organizationMembers.organizationId, activeOrganizationId),
      ))
      .limit(1)
    : [];

  if (activeOrganizationId && !membership) {
    enterUserDatabaseContext(base.userId);
    await db().update(sessions).set({ activeOrganizationId: null }).where(eq(sessions.id, base.sessionId));
  }

  const staleBefore = new Date(Date.now() - LAST_SEEN_WRITE_INTERVAL_MS);
  if (base.lastSeenAt < staleBefore) {
    enterUserDatabaseContext(base.userId, membership?.organizationId ?? null);
    await db()
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(sessions.id, base.sessionId), lt(sessions.lastSeenAt, staleBefore)));
  }

  return {
    sessionId: base.sessionId,
    userId: base.userId,
    email: base.email,
    name: base.name,
    organizationId: membership?.organizationId ?? null,
    organizationName: membership?.organizationName ?? null,
    role: membership?.role ?? null,
  };
}
