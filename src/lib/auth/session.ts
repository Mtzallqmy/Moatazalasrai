import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { enterTenantDatabaseContext, runWithSystemDatabaseContext } from "@/db/tenant-context";
import { organizationMembers, organizations, sessions, users } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { activeMembership } from "@/lib/auth/membership-access";
import { supabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureLocalIdentity, upsertSupabaseAppSession } from "@/lib/auth/supabase-identity";

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
  accessExpiresAt?: Date | null;
  ipAddress?: string;
  userAgent?: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const standardExpiry = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const expiresAt = input.accessExpiresAt && input.accessExpiresAt < standardExpiry
    ? input.accessExpiresAt
    : standardExpiry;
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
  await runWithSystemDatabaseContext(() => db().insert(sessions).values(values));
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  if (SESSION_COOKIE !== LEGACY_SESSION_COOKIE) store.delete(LEGACY_SESSION_COOKIE);
}

export async function revokeCurrentSession() {
  if (supabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const sessionId = typeof data?.claims?.session_id === "string" ? data.claims.session_id : null;
    if (sessionId) {
      await runWithSystemDatabaseContext(() => db().update(sessions).set({ revokedAt: new Date() })
        .where(eq(sessions.supabaseSessionId, sessionId)));
    }
    await supabase.auth.signOut({ scope: "local" });
    await clearSessionCookies();
    return;
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value
    ?? (SESSION_COOKIE !== LEGACY_SESSION_COOKIE ? store.get(LEGACY_SESSION_COOKIE)?.value : undefined);
  if (token) {
    await runWithSystemDatabaseContext(() => db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token))));
  }
  await clearSessionCookies();
}

export async function revokeAllSessions(userId: string) {
  await runWithSystemDatabaseContext(() => db().update(sessions).set({ revokedAt: new Date() }).where(and(
    eq(sessions.userId, userId),
    isNull(sessions.revokedAt),
  )));
  await clearSessionCookies();
  if (supabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "global" });
  }
}

export async function setActiveOrganization(userId: string, sessionId: string, organizationId: string) {
  await runWithSystemDatabaseContext(async () => {
    const [membership] = await db().select({ id: organizationMembers.id, expiresAt: organizationMembers.expiresAt }).from(organizationMembers).where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.organizationId, organizationId),
      activeMembership(),
    )).limit(1);
    if (!membership) throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "المؤسسة غير متاحة لهذا الحساب.");
    const [existing] = await db().select({ authSource: sessions.authSource }).from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt))).limit(1);
    if (!existing) throw new ApiError(401, "SESSION_INVALID", "انتهت الجلسة أو أُبطلت.");
    const nextToken = existing.authSource === "legacy" ? randomBytes(32).toString("base64url") : null;
    const [rotated] = await db().update(sessions).set({
      activeOrganizationId: organizationId,
      ...(nextToken ? { tokenHash: hashToken(nextToken) } : {}),
      lastSeenAt: new Date(),
    }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ expiresAt: sessions.expiresAt });
    if (!rotated) throw new ApiError(401, "SESSION_INVALID", "انتهت الجلسة أو أُبطلت.");
    if (nextToken) {
      const store = await cookies();
      store.set(SESSION_COOKIE, nextToken, cookieOptions(rotated.expiresAt));
      if (SESSION_COOKIE !== LEGACY_SESSION_COOKIE) store.delete(LEGACY_SESSION_COOKIE);
    }
  });
  enterTenantDatabaseContext(organizationId, userId);
}

async function resolveLegacyCurrentSession() {
  const store = await cookies();
  const primaryToken = store.get(SESSION_COOKIE)?.value;
  const legacyToken = SESSION_COOKIE !== LEGACY_SESSION_COOKIE ? store.get(LEGACY_SESSION_COOKIE)?.value : undefined;
  const token = primaryToken ?? legacyToken;
  if (!token) return null;

  const [base] = await db().select({
    sessionId: sessions.id,
    activeOrganizationId: sessions.activeOrganizationId,
    lastSeenAt: sessions.lastSeenAt,
    sessionExpiresAt: sessions.expiresAt,
    userId: users.id,
    email: users.email,
    name: users.name,
    membershipOrganizationId: organizationMembers.organizationId,
    organizationName: organizations.name,
    role: organizationMembers.role,
    membershipExpiresAt: organizationMembers.expiresAt,
  }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).leftJoin(organizationMembers, and(
    eq(organizationMembers.userId, users.id),
    eq(organizationMembers.organizationId, sessions.activeOrganizationId),
    activeMembership(),
  )).leftJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).where(and(
    eq(sessions.tokenHash, hashToken(token)),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, new Date()),
    gt(sessions.lastSeenAt, new Date(Date.now() - SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000)),
  )).limit(1);
  if (!base) return null;

  let activeOrganizationId = base.activeOrganizationId;
  let membership = base.membershipOrganizationId ? {
    organizationId: base.membershipOrganizationId,
    organizationName: base.organizationName,
    role: base.role,
    expiresAt: base.membershipExpiresAt,
  } : null;
  if (!activeOrganizationId) {
    const memberships = await db().select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers).where(and(eq(organizationMembers.userId, base.userId), activeMembership()))
      .orderBy(asc(organizationMembers.createdAt)).limit(2);
    if (memberships.length === 0) {
      await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, base.sessionId));
      await clearSessionCookies();
      return null;
    }
    if (memberships.length === 1) {
      activeOrganizationId = memberships[0].organizationId;
      await db().update(sessions).set({ activeOrganizationId }).where(eq(sessions.id, base.sessionId));
      [membership] = await db().select({
        organizationId: organizations.id,
        organizationName: organizations.name,
        role: organizationMembers.role,
        expiresAt: organizationMembers.expiresAt,
      }).from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(and(
          eq(organizationMembers.userId, base.userId),
          eq(organizationMembers.organizationId, activeOrganizationId),
          activeMembership(),
        ))
        .limit(1);
    }
  }

  if (activeOrganizationId && !membership) {
    await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, base.sessionId));
    await clearSessionCookies();
    return null;
  }

  const staleBefore = new Date(Date.now() - LAST_SEEN_WRITE_INTERVAL_MS);
  if (base.lastSeenAt < staleBefore) {
    await db().update(sessions).set({ lastSeenAt: new Date() })
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
    accessExpiresAt: membership?.expiresAt?.toISOString() ?? null,
  };
}

async function resolveSupabaseCurrentSession() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  const subject = typeof claims?.sub === "string" ? claims.sub : null;
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
  const exp = typeof claims?.exp === "number" ? claims.exp : null;
  if (error || !subject || !sessionId || !exp || exp * 1000 <= Date.now()) return null;

  let [localUser] = await db().select({ id: users.id }).from(users).where(eq(users.supabaseUserId, subject)).limit(1);
  if (!localUser) {
    const { data: verified, error: userError } = await supabase.auth.getUser();
    if (userError || !verified.user || verified.user.id !== subject) return null;
    localUser = await ensureLocalIdentity(verified.user);
  }

  let [base] = await db().select({
    sessionId: sessions.id,
    activeOrganizationId: sessions.activeOrganizationId,
    lastSeenAt: sessions.lastSeenAt,
    userId: users.id,
    email: users.email,
    name: users.name,
    membershipOrganizationId: organizationMembers.organizationId,
    organizationName: organizations.name,
    role: organizationMembers.role,
    membershipExpiresAt: organizationMembers.expiresAt,
  }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).leftJoin(organizationMembers, and(
    eq(organizationMembers.userId, users.id),
    eq(organizationMembers.organizationId, sessions.activeOrganizationId),
    activeMembership(),
  )).leftJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).where(and(
    eq(sessions.supabaseSessionId, sessionId),
    eq(users.supabaseUserId, subject),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, new Date()),
  )).limit(1);

  if (!base) {
    let appSession;
    try {
      appSession = await upsertSupabaseAppSession({ userId: localUser.id, supabaseSessionId: sessionId, expiresAt: new Date(exp * 1000) });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "ACCOUNT_ACCESS_EXPIRED") {
        await supabase.auth.signOut({ scope: "local" });
        return null;
      }
      throw cause;
    }
    [base] = await db().select({
      sessionId: sessions.id,
      activeOrganizationId: sessions.activeOrganizationId,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      membershipOrganizationId: organizationMembers.organizationId,
      organizationName: organizations.name,
      role: organizationMembers.role,
      membershipExpiresAt: organizationMembers.expiresAt,
    }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).leftJoin(organizationMembers, and(
      eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, sessions.activeOrganizationId), activeMembership(),
    )).leftJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(sessions.id, appSession.id)).limit(1);
  }
  if (!base) return null;
  if (base.activeOrganizationId && !base.membershipOrganizationId) {
    await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, base.sessionId));
    await supabase.auth.signOut({ scope: "local" });
    return null;
  }
  const staleBefore = new Date(Date.now() - LAST_SEEN_WRITE_INTERVAL_MS);
  if (base.lastSeenAt < staleBefore) {
    await db().update(sessions).set({ lastSeenAt: new Date() }).where(and(eq(sessions.id, base.sessionId), lt(sessions.lastSeenAt, staleBefore)));
  }
  return {
    sessionId: base.sessionId,
    userId: base.userId,
    email: base.email,
    name: base.name,
    organizationId: base.membershipOrganizationId ?? null,
    organizationName: base.organizationName ?? null,
    role: base.role ?? null,
    accessExpiresAt: base.membershipExpiresAt?.toISOString() ?? null,
  };
}

async function resolveCurrentSession() {
  return supabaseAuthConfigured() ? resolveSupabaseCurrentSession() : resolveLegacyCurrentSession();
}

const resolveCachedCurrentSession = cache(() => runWithSystemDatabaseContext(resolveCurrentSession));

export async function currentSession() {
  const session = await resolveCachedCurrentSession();
  if (session?.organizationId) enterTenantDatabaseContext(session.organizationId, session.userId);
  return session;
}
