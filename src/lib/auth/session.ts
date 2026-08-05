import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { organizationMembers, organizations, sessions, users } from "@/db/schema";
import { ApiError } from "@/lib/http/api";

const LEGACY_SESSION_COOKIE = "moataz_session";
export const SESSION_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-moataz_session"
  : LEGACY_SESSION_COOKIE;
const SESSION_DAYS = 30;
const SESSION_IDLE_DAYS = 7;
const LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

async function clearSessionCookies() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  if (SESSION_COOKIE !== LEGACY_SESSION_COOKIE) store.delete(LEGACY_SESSION_COOKIE);
}

export async function createSession(input: {
  userId: string;
  activeOrganizationId?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
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
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  if (SESSION_COOKIE !== LEGACY_SESSION_COOKIE) store.delete(LEGACY_SESSION_COOKIE);
}

export async function revokeCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value
    ?? (SESSION_COOKIE !== LEGACY_SESSION_COOKIE ? store.get(LEGACY_SESSION_COOKIE)?.value : undefined);
  if (token) {
    await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
  }
  await clearSessionCookies();
}

export async function revokeAllSessions(userId: string) {
  await db().update(sessions).set({ revokedAt: new Date() }).where(and(
    eq(sessions.userId, userId),
    isNull(sessions.revokedAt),
  ));
  await clearSessionCookies();
}

export async function setActiveOrganization(userId: string, sessionId: string, organizationId: string) {
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
  const store = await cookies();
  store.set(SESSION_COOKIE, nextToken, cookieOptions(rotated.expiresAt));
  if (SESSION_COOKIE !== LEGACY_SESSION_COOKIE) store.delete(LEGACY_SESSION_COOKIE);
}

export async function currentSession() {
  const store = await cookies();
  const primaryToken = store.get(SESSION_COOKIE)?.value;
  const legacyToken = SESSION_COOKIE !== LEGACY_SESSION_COOKIE
    ? store.get(LEGACY_SESSION_COOKIE)?.value
    : undefined;
  const token = primaryToken ?? legacyToken;
  if (!token) return null;

  const [base] = await db()
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
    .limit(1);

  if (!base) return null;

  let activeOrganizationId = base.activeOrganizationId;
  if (!activeOrganizationId) {
    const memberships = await db()
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, base.userId))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(2);
    if (memberships.length === 1) {
      activeOrganizationId = memberships[0].organizationId;
      await db().update(sessions).set({ activeOrganizationId }).where(eq(sessions.id, base.sessionId));
    }
  }

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
    await db().update(sessions).set({ activeOrganizationId: null }).where(eq(sessions.id, base.sessionId));
  }

  const staleBefore = new Date(Date.now() - LAST_SEEN_WRITE_INTERVAL_MS);
  if (base.lastSeenAt < staleBefore) {
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
