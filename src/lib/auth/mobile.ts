import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mobileSessions, organizationMembers, organizations, users } from "@/db/schema";
import { getPostgresPool } from "@/db/pool";
import { ApiError } from "@/lib/http/api";
import { hashApiKey } from "@/lib/security/encryption";
import { activeMembership } from "@/lib/auth/membership-access";

const ACCESS_MINUTES = 15;
const REFRESH_DAYS = 90;

function token(prefix: "mat" | "mrt") {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function expiresIn(ms: number) {
  return new Date(Date.now() + ms);
}

type IssueMobileSessionInput = {
  userId: string;
  organizationId: string;
  deviceId: string;
  deviceName?: string;
  rememberSession?: boolean;
};

function earlierExpiry(standard: Date, membership: Date | null) {
  return membership && membership < standard ? membership : standard;
}

function mobileSessionMaterial(input: IssueMobileSessionInput, membershipExpiresAt: Date | null) {
  const accessToken = token("mat");
  const refreshToken = token("mrt");
  const accessExpiresAt = earlierExpiry(expiresIn(ACCESS_MINUTES * 60_000), membershipExpiresAt);
  const refreshDays = input.rememberSession === false ? 1 : REFRESH_DAYS;
  const refreshExpiresAt = earlierExpiry(expiresIn(refreshDays * 24 * 60 * 60_000), membershipExpiresAt);
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, refreshDays };
}

export async function issueMobileSessionWithClient(client: PoolClient, input: IssueMobileSessionInput) {
  const membershipResult = await client.query<{ expires_at: Date | null }>(`
    SELECT expires_at
    FROM organization_members
    WHERE user_id = $1 AND organization_id = $2
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `, [input.userId, input.organizationId]);
  const membership = membershipResult.rows[0];
  if (!membership) throw new ApiError(403, "ACCOUNT_ACCESS_EXPIRED", "انتهت صلاحية استخدام الحساب أو أوقفه مدير المؤسسة.");
  const material = mobileSessionMaterial(input, membership.expires_at);
  const result = await client.query<{ id: string }>(`
    INSERT INTO mobile_sessions (
      user_id, organization_id, access_token_hash, access_expires_at,
      refresh_token_hash, refresh_expires_at, device_id, device_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id, device_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      access_token_hash = EXCLUDED.access_token_hash,
      access_expires_at = EXCLUDED.access_expires_at,
      refresh_token_hash = EXCLUDED.refresh_token_hash,
      refresh_expires_at = EXCLUDED.refresh_expires_at,
      device_name = EXCLUDED.device_name,
      revoked_at = NULL,
      last_used_at = now(),
      updated_at = now()
    RETURNING id
  `, [
    input.userId,
    input.organizationId,
    hashApiKey(material.accessToken),
    material.accessExpiresAt,
    hashApiKey(material.refreshToken),
    material.refreshExpiresAt,
    input.deviceId,
    input.deviceName ?? null,
  ]);
  const session = result.rows[0];
  if (!session) throw new Error("MOBILE_SESSION_CREATE_FAILED");
  return {
    sessionId: session.id,
    accessToken: material.accessToken,
    refreshToken: material.refreshToken,
    tokenType: "Bearer" as const,
    expiresIn: Math.max(1, Math.floor((material.accessExpiresAt.getTime() - Date.now()) / 1000)),
    refreshExpiresIn: Math.max(1, Math.floor((material.refreshExpiresAt.getTime() - Date.now()) / 1000)),
  };
}

export async function issueMobileSession(input: IssueMobileSessionInput) {
  const client = await getPostgresPool().connect();
  try {
    return await issueMobileSessionWithClient(client, input);
  } finally {
    client.release();
  }
}

export async function rotateMobileSession(refreshToken: string) {
  const [current] = await db().select().from(mobileSessions).where(and(
    eq(mobileSessions.refreshTokenHash, hashApiKey(refreshToken)),
    isNull(mobileSessions.revokedAt),
    gt(mobileSessions.refreshExpiresAt, new Date()),
  )).limit(1);
  if (!current) throw new ApiError(401, "REFRESH_TOKEN_INVALID", "انتهت جلسة التطبيق أو أُبطلت.");

  const [membership] = await db().select({ expiresAt: organizationMembers.expiresAt })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.userId, current.userId),
      eq(organizationMembers.organizationId, current.organizationId),
      activeMembership(),
    )).limit(1);
  if (!membership) {
    await db().update(mobileSessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(mobileSessions.id, current.id));
    throw new ApiError(401, "ACCOUNT_ACCESS_EXPIRED", "انتهت صلاحية استخدام الحساب. سجّل الدخول بحساب مصرح له.");
  }

  const accessToken = token("mat");
  const nextRefreshToken = token("mrt");
  const accessExpiresAt = earlierExpiry(expiresIn(ACCESS_MINUTES * 60_000), membership.expiresAt);
  const refreshExpiresAt = earlierExpiry(expiresIn(REFRESH_DAYS * 24 * 60 * 60_000), membership.expiresAt);
  const [rotated] = await db().update(mobileSessions).set({
    accessTokenHash: hashApiKey(accessToken),
    accessExpiresAt,
    refreshTokenHash: hashApiKey(nextRefreshToken),
    refreshExpiresAt,
    lastUsedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(mobileSessions.id, current.id),
    eq(mobileSessions.refreshTokenHash, hashApiKey(refreshToken)),
    isNull(mobileSessions.revokedAt),
  )).returning({ id: mobileSessions.id });
  if (!rotated) {
    throw new ApiError(401, "REFRESH_TOKEN_REUSED", "استُخدم رمز تحديث مستبدل. سجّل الدخول مجددًا لحماية الجهاز.");
  }
  return {
    sessionId: current.id,
    accessToken,
    refreshToken: nextRefreshToken,
    tokenType: "Bearer" as const,
    expiresIn: Math.max(1, Math.floor((accessExpiresAt.getTime() - Date.now()) / 1000)),
    refreshExpiresIn: Math.max(1, Math.floor((refreshExpiresAt.getTime() - Date.now()) / 1000)),
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
    expiresAt: organizationMembers.expiresAt,
  }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), activeMembership()));
}

export async function mobileMe(userId: string, organizationId: string) {
  const [identity] = await db().select({
    id: users.id,
    email: users.email,
    name: users.name,
    organizationId: organizations.id,
    organizationName: organizations.name,
    role: organizationMembers.role,
    expiresAt: organizationMembers.expiresAt,
  }).from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(users.id, userId), eq(organizations.id, organizationId), activeMembership()))
    .limit(1);
  return identity ?? null;
}
