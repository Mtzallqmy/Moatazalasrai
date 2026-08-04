import { randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import {
  mfaSessionVerifications,
  userMfaRecoveryCodes,
  userTotpFactors,
} from "@/db/security-schema";
import { organizationMembers } from "@/db/schema";
import type { Permission, Role } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/http/api";
import { decryptSecret, encryptSecret, hashApiKey } from "@/lib/security/encryption";
import {
  generateTotpSecret,
  normalizeMfaCode,
  totpAuthUri,
  verifyTotpCode,
} from "@/lib/security/totp";

const MFA_VERIFICATION_TTL_MS = 12 * 60 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

const sensitivePermissions = new Set<Permission>([
  "providers:manage",
  "agents:manage",
  "agents:run",
  "members:manage",
  "organization:manage",
  "integrations:manage",
  "files:upload",
  "files:manage",
  "site_connections:manage",
  "site_connections:approve",
  "browser_tasks:run",
  "browser_tasks:manage",
  "browser_tasks:approve",
  "sandbox:use",
  "sandbox:manage",
  "sandbox:approve",
]);

function privilegedRole(role: Role | string | null | undefined) {
  return role === "owner" || role === "admin";
}

export function permissionRequiresMfa(role: Role | null | undefined, permission?: Permission) {
  return Boolean(permission && privilegedRole(role) && sensitivePermissions.has(permission));
}

function factorContext(userId: string) {
  return `mfa:totp:${userId}`;
}

function recoveryContext(userId: string) {
  return `mfa:recovery:${userId}`;
}

function recoveryCode() {
  const value = randomBytes(8).toString("hex").toUpperCase();
  return `MFA-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
}

export async function userHasPrivilegedMembership(userId: string) {
  const [row] = await db().select({ id: organizationMembers.id }).from(organizationMembers).where(and(
    eq(organizationMembers.userId, userId),
    or(eq(organizationMembers.role, "owner"), eq(organizationMembers.role, "admin")),
  )).limit(1);
  return Boolean(row);
}

export async function mfaStatusForUser(userId: string) {
  const [[factor], [recovery]] = await Promise.all([
    db().select({ verifiedAt: userTotpFactors.verifiedAt }).from(userTotpFactors)
      .where(eq(userTotpFactors.userId, userId)).limit(1),
    db().select({ value: count() }).from(userMfaRecoveryCodes).where(and(
      eq(userMfaRecoveryCodes.userId, userId),
      isNull(userMfaRecoveryCodes.usedAt),
    )),
  ]);
  return {
    enabled: Boolean(factor?.verifiedAt),
    pendingEnrollment: Boolean(factor && !factor.verifiedAt),
    verifiedAt: factor?.verifiedAt ?? null,
    unusedRecoveryCodes: recovery?.value ?? 0,
  };
}

export async function beginMfaEnrollment(input: { userId: string; email: string; issuer?: string }) {
  if (!(await userHasPrivilegedMembership(input.userId))) {
    throw new ApiError(403, "MFA_NOT_REQUIRED", "التحقق الثنائي مخصص حاليًا للمالكين والمديرين.");
  }
  const secret = generateTotpSecret();
  await db().transaction(async (tx) => {
    await tx.insert(userTotpFactors).values({
      userId: input.userId,
      encryptedSecret: encryptSecret(secret, factorContext(input.userId)),
      verifiedAt: null,
      lastUsedCounter: null,
    }).onConflictDoUpdate({
      target: userTotpFactors.userId,
      set: {
        encryptedSecret: encryptSecret(secret, factorContext(input.userId)),
        verifiedAt: null,
        lastUsedCounter: null,
        updatedAt: new Date(),
      },
    });
    await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, input.userId));
  });
  const issuer = input.issuer?.trim() || "Moataz Agent Platform";
  return {
    secret,
    otpauthUri: totpAuthUri({ secret, account: input.email, issuer }),
    algorithm: "SHA1" as const,
    digits: 6 as const,
    period: 30 as const,
  };
}

export async function completeMfaEnrollment(userId: string, code: string) {
  return db().transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT "user_id" FROM "user_totp_factors"
      WHERE "user_id" = ${userId}
      FOR UPDATE
    `);
    if (databaseRows(locked).length === 0) {
      throw new ApiError(409, "MFA_ENROLLMENT_NOT_STARTED", "ابدأ إعداد التحقق الثنائي أولًا.");
    }
    const [factor] = await tx.select().from(userTotpFactors)
      .where(eq(userTotpFactors.userId, userId)).limit(1);
    if (!factor) throw new ApiError(409, "MFA_ENROLLMENT_NOT_STARTED", "ابدأ إعداد التحقق الثنائي أولًا.");
    const secret = decryptSecret(factor.encryptedSecret, factorContext(userId));
    const counter = verifyTotpCode({ secret, code, window: 1 });
    if (counter === null) throw new ApiError(401, "MFA_CODE_INVALID", "رمز التحقق الثنائي غير صالح.");

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    await tx.update(userTotpFactors).set({
      verifiedAt: new Date(),
      lastUsedCounter: String(counter),
      updatedAt: new Date(),
    }).where(eq(userTotpFactors.userId, userId));
    await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
    await tx.insert(userMfaRecoveryCodes).values(codes.map((value) => ({
      userId,
      codeHash: hashApiKey(normalizeMfaCode(value)),
      encryptedCode: encryptSecret(value, recoveryContext(userId)),
    })));
    return { recoveryCodes: codes };
  });
}

export async function verifyUserMfaCode(userId: string, suppliedCode: string) {
  const normalized = normalizeMfaCode(suppliedCode);
  if (/^\d{6}$/.test(normalized)) {
    return db().transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT "user_id" FROM "user_totp_factors"
        WHERE "user_id" = ${userId}
        FOR UPDATE
      `);
      if (databaseRows(locked).length === 0) {
        throw new ApiError(403, "MFA_ENROLLMENT_REQUIRED", "فعّل التحقق الثنائي قبل متابعة العملية.");
      }
      const [factor] = await tx.select().from(userTotpFactors)
        .where(eq(userTotpFactors.userId, userId)).limit(1);
      if (!factor?.verifiedAt) {
        throw new ApiError(403, "MFA_ENROLLMENT_REQUIRED", "فعّل التحقق الثنائي قبل متابعة العملية.");
      }
      const secret = decryptSecret(factor.encryptedSecret, factorContext(userId));
      const lastUsedCounter = factor.lastUsedCounter === null ? null : Number(factor.lastUsedCounter);
      const counter = verifyTotpCode({ secret, code: normalized, lastUsedCounter, window: 1 });
      if (counter === null) throw new ApiError(401, "MFA_CODE_INVALID", "رمز التحقق الثنائي غير صالح أو استُخدم سابقًا.");
      await tx.update(userTotpFactors).set({
        lastUsedCounter: String(counter),
        updatedAt: new Date(),
      }).where(eq(userTotpFactors.userId, userId));
      return { method: "totp" as const };
    });
  }

  const codeHash = hashApiKey(normalized);
  const [recovery] = await db().update(userMfaRecoveryCodes).set({ usedAt: new Date() }).where(and(
    eq(userMfaRecoveryCodes.userId, userId),
    eq(userMfaRecoveryCodes.codeHash, codeHash),
    isNull(userMfaRecoveryCodes.usedAt),
  )).returning({ encryptedCode: userMfaRecoveryCodes.encryptedCode });
  if (!recovery) throw new ApiError(401, "MFA_CODE_INVALID", "رمز التحقق أو الاسترداد غير صالح.");
  const stored = normalizeMfaCode(decryptSecret(recovery.encryptedCode, recoveryContext(userId)));
  if (stored !== normalized) throw new ApiError(401, "MFA_CODE_INVALID", "رمز الاسترداد غير صالح.");
  return { method: "recovery" as const };
}

function verificationExpiry() {
  return new Date(Date.now() + MFA_VERIFICATION_TTL_MS);
}

export async function markWebSessionMfaVerified(input: {
  userId: string;
  sessionId: string;
  method: "totp" | "recovery";
}) {
  await db().transaction(async (tx) => {
    await tx.delete(mfaSessionVerifications).where(eq(mfaSessionVerifications.sessionId, input.sessionId));
    await tx.insert(mfaSessionVerifications).values({
      userId: input.userId,
      sessionId: input.sessionId,
      method: input.method,
      expiresAt: verificationExpiry(),
    });
  });
}

export async function markMobileSessionMfaVerified(input: {
  userId: string;
  mobileSessionId: string;
  method: "totp" | "recovery";
}) {
  await db().transaction(async (tx) => {
    await tx.delete(mfaSessionVerifications).where(eq(mfaSessionVerifications.mobileSessionId, input.mobileSessionId));
    await tx.insert(mfaSessionVerifications).values({
      userId: input.userId,
      mobileSessionId: input.mobileSessionId,
      method: input.method,
      expiresAt: verificationExpiry(),
    });
  });
}

export async function freshWebSessionMfa(sessionId: string, userId: string) {
  const [row] = await db().select({ verifiedAt: mfaSessionVerifications.verifiedAt })
    .from(mfaSessionVerifications).where(and(
      eq(mfaSessionVerifications.sessionId, sessionId),
      eq(mfaSessionVerifications.userId, userId),
      gt(mfaSessionVerifications.expiresAt, new Date()),
    )).limit(1);
  return row?.verifiedAt ?? null;
}

export async function freshMobileSessionMfa(mobileSessionId: string, userId: string) {
  const [row] = await db().select({ verifiedAt: mfaSessionVerifications.verifiedAt })
    .from(mfaSessionVerifications).where(and(
      eq(mfaSessionVerifications.mobileSessionId, mobileSessionId),
      eq(mfaSessionVerifications.userId, userId),
      gt(mfaSessionVerifications.expiresAt, new Date()),
    )).limit(1);
  return row?.verifiedAt ?? null;
}

export async function assertFreshMfa(input: {
  userId: string;
  sessionId: string;
  role: Role;
  permission?: Permission;
}) {
  if (!permissionRequiresMfa(input.role, input.permission)) return;
  const status = await mfaStatusForUser(input.userId);
  if (!status.enabled) {
    throw new ApiError(403, "MFA_ENROLLMENT_REQUIRED", "يجب تفعيل التحقق الثنائي قبل تنفيذ هذه العملية الحساسة.");
  }
  if (!(await freshWebSessionMfa(input.sessionId, input.userId))) {
    throw new ApiError(403, "MFA_REQUIRED", "أكمل التحقق الثنائي قبل تنفيذ هذه العملية الحساسة.");
  }
}

export function apiScopeRequiresMfa(scope: string) {
  return scope.endsWith(":write") || scope === "chat:write";
}

export { privilegedRole };
