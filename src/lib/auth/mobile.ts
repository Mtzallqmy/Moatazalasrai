import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mobileSessions, organizationMembers, organizations, users } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { hashApiKey } from "@/lib/security/encryption";

const ACCESS_MINUTES = 15;
const REFRESH_DAYS = 90;

function token(prefix: "mat" | "mrt") {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function expiresIn(ms: number) {
  return new Date(Date.now() + ms);
}

export async function issueMobileSession(input: {
  userId: string;
  organizationId: string;
  deviceId: string;
  deviceName?: string;
  rememberSession?: boolean;
}) {
  const accessToken = token("mat");
  const refreshToken = token("mrt");
  const accessExpiresAt = expiresIn(ACCESS_MINUTES * 60_000);
  const refreshDays = input.rememberSession === false ? 1 : REFRESH_DAYS;
  const refreshExpiresAt = expiresIn(refreshDays * 24 * 60 * 60_000);
  const [session] = await db().insert(mobileSessions).values({
    userId: input.userId,
    organizationId: input.organizationId,
    accessTokenHash: hashApiKey(accessToken),
    accessExpiresAt,
    refreshTokenHash: hashApiKey(refreshToken),
    refreshExpiresAt,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
  }).onConflictDoUpdate({
    target: [mobileSessions.userId, mobileSessions.deviceId],
    set: {
      organizationId: input.organizationId,
      accessTokenHash: hashApiKey(accessToken),
      accessExpiresAt,
      refreshTokenHash: hashApiKey(refreshToken),
      refreshExpiresAt,
      deviceName: input.deviceName,
      revokedAt: null,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning({ id: mobileSessions.id });
  if (!session) throw new Error("MOBILE_SESSION_CREATE_FAILED");
  return {
    sessionId: session.id,
    accessToken,
    refreshToken,
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_MINUTES * 60,
    refreshExpiresIn: refreshDays * 24 * 60 * 60,
  };
}

export async function rotateMobileSession(refreshToken: string) {
  const [current] = await db().select().from(mobileSessions).where(and(
    eq(mobileSessions.refreshTokenHash, hashApiKey(refreshToken)),
    isNull(mobileSessions.revokedAt),
    gt(mobileSessions.refreshExpiresAt, new Date()),
  )).limit(1);
  if (!current) throw new ApiError(401, "REFRESH_TOKEN_INVALID", "انتهت جلسة التطبيق أو أُبطلت.");

  const accessToken = token("mat");
  const nextRefreshToken = token("mrt");
  const accessExpiresAt = expiresIn(ACCESS_MINUTES * 60_000);
  const refreshExpiresAt = expiresIn(REFRESH_DAYS * 24 * 60 * 60_000);
  await db().update(mobileSessions).set({
    accessTokenHash: hashApiKey(accessToken),
    accessExpiresAt,
    refreshTokenHash: hashApiKey(nextRefreshToken),
    refreshExpiresAt,
    lastUsedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(mobileSessions.id, current.id), eq(mobileSessions.refreshTokenHash, hashApiKey(refreshToken))));
  return {
    sessionId: current.id,
    accessToken,
    refreshToken: nextRefreshToken,
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_MINUTES * 60,
    refreshExpiresIn: REFRESH_DAYS * 24 * 60 * 60,
  };
}

export async function revokeMobileSession(refreshToken: string) {
  await db().update(mobileSessions).set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(mobileSessions.refreshTokenHash, hashApiKey(refreshToken)));
}

export async function mobileOrganizations(userId: string) {
  return db().select({
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
    role: organizationMembers.role,
  }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId));
}

export async function mobileMe(userId: string, organizationId: string) {
  const [identity] = await db().select({
    id: users.id,
    email: users.email,
    name: users.name,
    organizationId: organizations.id,
    organizationName: organizations.name,
    role: organizationMembers.role,
  }).from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(users.id, userId), eq(organizations.id, organizationId)))
    .limit(1);
  return identity ?? null;
}
