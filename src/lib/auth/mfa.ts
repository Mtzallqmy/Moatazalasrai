import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { getPostgresPool } from "@/db/pool";
import { userMfaCredentials } from "@/db/admin-schema";
import { auditLogs, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { ApiError } from "@/lib/http/api";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  verifyTotp,
} from "@/lib/security/totp";

const MFA_FAILURE_LIMIT = 5;
const MFA_LOCK_MS = 15 * 60_000;

type LockedMfaRow = {
  encrypted_secret: string;
  enabled: boolean;
  last_used_step: number | null;
  recovery_code_hashes: unknown;
  failed_attempts: number;
  locked_until: Date | null;
};

function recoveryHashes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function requireCurrentPassword(userId: string, password: string) {
  const [user] = await db().select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "CURRENT_PASSWORD_INVALID", "كلمة المرور الحالية غير صحيحة.");
  }
}

async function writeSecurityAudit(input: {
  organizationId?: string | null;
  userId: string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  await db().insert(auditLogs).values({
    organizationId: input.organizationId ?? null,
    actorType: "user",
    actorId: input.userId,
    action: input.action,
    resourceType: "user_security",
    resourceId: input.userId,
    metadata: input.metadata ?? {},
  });
}

export async function mfaStatus(userId: string) {
  const [credential] = await db().select({
    enabled: userMfaCredentials.enabled,
    enabledAt: userMfaCredentials.enabledAt,
    recoveryCodesRemaining: userMfaCredentials.recoveryCodeHashes,
    lockedUntil: userMfaCredentials.lockedUntil,
  }).from(userMfaCredentials).where(eq(userMfaCredentials.userId, userId)).limit(1);
  return {
    configured: Boolean(credential),
    enabled: credential?.enabled ?? false,
    enabledAt: credential?.enabledAt ?? null,
    recoveryCodesRemaining: credential?.recoveryCodesRemaining.length ?? 0,
    lockedUntil: credential?.lockedUntil ?? null,
  };
}

export async function beginMfaEnrollment(input: {
  userId: string;
  organizationId: string;
  email: string;
  password: string;
}) {
  await requireCurrentPassword(input.userId, input.password);
  const [existing] = await db().select({ enabled: userMfaCredentials.enabled })
    .from(userMfaCredentials).where(eq(userMfaCredentials.userId, input.userId)).limit(1);
  if (existing?.enabled) throw new ApiError(409, "MFA_ALREADY_ENABLED", "المصادقة متعددة العوامل مفعلة بالفعل.");

  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  await db().insert(userMfaCredentials).values({
    userId: input.userId,
    encryptedSecret: encryptSecret(secret, `mfa:${input.userId}`),
    secretHint: secret.slice(-4),
    enabled: false,
    lastUsedStep: null,
    recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    failedAttempts: 0,
    lockedUntil: null,
  }).onConflictDoUpdate({
    target: userMfaCredentials.userId,
    set: {
      encryptedSecret: encryptSecret(secret, `mfa:${input.userId}`),
      secretHint: secret.slice(-4),
      enabled: false,
      enabledAt: null,
      lastUsedStep: null,
      recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    },
  });
  await writeSecurityAudit({ organizationId: input.organizationId, userId: input.userId, action: "security.mfa.enrollment_started" });
  return {
    secret,
    uri: totpUri({ secret, account: input.email, issuer: "Moatazalasrai" }),
    recoveryCodes,
  };
}

export async function confirmMfaEnrollment(input: {
  userId: string;
  organizationId: string;
  code: string;
}) {
  const [credential] = await db().select().from(userMfaCredentials)
    .where(eq(userMfaCredentials.userId, input.userId)).limit(1);
  if (!credential) throw new ApiError(404, "MFA_ENROLLMENT_NOT_FOUND", "ابدأ إعداد المصادقة متعددة العوامل أولًا.");
  if (credential.enabled) return mfaStatus(input.userId);
  const secret = decryptSecret(credential.encryptedSecret, `mfa:${input.userId}`);
  const step = verifyTotp({ secret, code: input.code, lastUsedStep: credential.lastUsedStep });
  if (step === null) throw new ApiError(401, "MFA_CODE_INVALID", "رمز المصادقة غير صحيح أو منتهي الصلاحية.");
  await db().update(userMfaCredentials).set({
    enabled: true,
    enabledAt: new Date(),
    lastUsedStep: step,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  }).where(eq(userMfaCredentials.userId, input.userId));
  await writeSecurityAudit({ organizationId: input.organizationId, userId: input.userId, action: "security.mfa.enabled" });
  return mfaStatus(input.userId);
}

export async function verifyMfaForLogin(input: { userId: string; code?: string | null }) {
  const client = await getPostgresPool().connect();
  let finished = false;
  try {
    await client.query("BEGIN");
    const result = await client.query<LockedMfaRow>(`
      SELECT encrypted_secret, enabled, last_used_step, recovery_code_hashes, failed_attempts, locked_until
      FROM user_mfa_credentials
      WHERE user_id = $1
      FOR UPDATE
    `, [input.userId]);
    const credential = result.rows[0];
    if (!credential?.enabled) {
      await client.query("COMMIT");
      finished = true;
      return false;
    }
    const now = new Date();
    if (credential.locked_until && credential.locked_until > now) {
      await client.query("ROLLBACK");
      finished = true;
      throw new ApiError(423, "MFA_TEMPORARILY_LOCKED", "تم قفل التحقق مؤقتًا بعد محاولات متعددة. حاول لاحقًا.");
    }
    const code = input.code?.trim();
    if (!code) {
      await client.query("ROLLBACK");
      finished = true;
      throw new ApiError(428, "MFA_REQUIRED", "أدخل رمز تطبيق المصادقة أو أحد رموز الاسترداد.");
    }

    const hashes = recoveryHashes(credential.recovery_code_hashes);
    const recoveryHash = hashRecoveryCode(code);
    const recoveryIndex = hashes.findIndex((hash) => hash === recoveryHash);
    let step: number | null = null;
    let nextHashes = hashes;
    let valid = recoveryIndex >= 0;
    if (valid) nextHashes = hashes.filter((_, index) => index !== recoveryIndex);
    else {
      const secret = decryptSecret(credential.encrypted_secret, `mfa:${input.userId}`);
      step = verifyTotp({ secret, code, lastUsedStep: credential.last_used_step });
      valid = step !== null;
    }

    if (!valid) {
      const attempts = credential.failed_attempts + 1;
      const lockedUntil = attempts >= MFA_FAILURE_LIMIT ? new Date(Date.now() + MFA_LOCK_MS) : null;
      await client.query(`
        UPDATE user_mfa_credentials
        SET failed_attempts = $2, locked_until = $3, updated_at = now()
        WHERE user_id = $1
      `, [input.userId, attempts, lockedUntil]);
      await client.query("COMMIT");
      finished = true;
      await writeSecurityAudit({ userId: input.userId, action: "security.mfa.login_failed", metadata: { attempts, locked: Boolean(lockedUntil) } }).catch(() => undefined);
      throw new ApiError(401, "MFA_CODE_INVALID", "رمز المصادقة غير صحيح أو منتهي الصلاحية.");
    }

    await client.query(`
      UPDATE user_mfa_credentials
      SET last_used_step = COALESCE($2, last_used_step), recovery_code_hashes = $3::jsonb,
          failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE user_id = $1
    `, [input.userId, step, JSON.stringify(nextHashes)]);
    await client.query("COMMIT");
    finished = true;
    return true;
  } catch (error) {
    if (!finished) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function regenerateRecoveryCodes(input: {
  userId: string;
  organizationId: string;
  password: string;
  code: string;
}) {
  await requireCurrentPassword(input.userId, input.password);
  await verifyMfaForLogin({ userId: input.userId, code: input.code });
  const recoveryCodes = generateRecoveryCodes();
  await db().update(userMfaCredentials).set({
    recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    updatedAt: new Date(),
  }).where(and(eq(userMfaCredentials.userId, input.userId), eq(userMfaCredentials.enabled, true)));
  await writeSecurityAudit({ organizationId: input.organizationId, userId: input.userId, action: "security.mfa.recovery_codes_regenerated" });
  return { recoveryCodes };
}

export async function disableMfa(input: {
  userId: string;
  organizationId: string;
  password: string;
  code: string;
}) {
  await requireCurrentPassword(input.userId, input.password);
  await verifyMfaForLogin({ userId: input.userId, code: input.code });
  await db().delete(userMfaCredentials).where(eq(userMfaCredentials.userId, input.userId));
  await writeSecurityAudit({ organizationId: input.organizationId, userId: input.userId, action: "security.mfa.disabled" });
  return { enabled: false };
}
