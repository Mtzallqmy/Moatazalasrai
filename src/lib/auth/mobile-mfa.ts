import { createHash, randomBytes } from "node:crypto";
import { getPostgresPool } from "@/db/pool";
import { issueMobileSession } from "@/lib/auth/mobile";
import { verifyMfaForLogin } from "@/lib/auth/mfa";
import { ApiError } from "@/lib/http/api";

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issueMobileMfaChallenge(input: {
  userId: string;
  organizationId: string;
  deviceId: string;
  deviceName?: string;
  rememberSession: boolean;
}) {
  const challengeToken = `mmc_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await getPostgresPool().query(`
    INSERT INTO mobile_mfa_challenges
      (token_hash, user_id, organization_id, device_id, device_name, remember_session, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    hashToken(challengeToken),
    input.userId,
    input.organizationId,
    input.deviceId,
    input.deviceName ?? null,
    input.rememberSession,
    expiresAt,
  ]);
  return { challengeToken, expiresAt };
}

type ChallengeRow = {
  id: string;
  user_id: string;
  organization_id: string;
  device_id: string;
  device_name: string | null;
  remember_session: boolean;
  attempt_count: number;
  expires_at: Date;
  used_at: Date | null;
};

export async function verifyMobileMfaChallenge(input: {
  challengeToken: string;
  code: string;
}) {
  const client = await getPostgresPool().connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const result = await client.query<ChallengeRow>(`
      SELECT id, user_id, organization_id, device_id, device_name, remember_session,
             attempt_count, expires_at, used_at
      FROM mobile_mfa_challenges
      WHERE token_hash = $1
      FOR UPDATE
    `, [hashToken(input.challengeToken)]);
    const challenge = result.rows[0];
    if (!challenge) throw new ApiError(401, "MFA_CHALLENGE_INVALID", "تعذر التحقق من طلب المصادقة.");
    if (challenge.used_at) throw new ApiError(401, "MFA_CHALLENGE_USED", "تعذر التحقق من طلب المصادقة.");
    if (challenge.expires_at.getTime() <= Date.now()) throw new ApiError(401, "MFA_CHALLENGE_EXPIRED", "انتهت صلاحية طلب المصادقة.");
    if (challenge.attempt_count >= CHALLENGE_MAX_ATTEMPTS) throw new ApiError(423, "MFA_CHALLENGE_LOCKED", "تعذر التحقق من طلب المصادقة.");

    try {
      await verifyMfaForLogin({ userId: challenge.user_id, code: input.code });
    } catch (error) {
      await client.query(`
        UPDATE mobile_mfa_challenges
        SET attempt_count = LEAST(attempt_count + 1, $2)
        WHERE id = $1
      `, [challenge.id, CHALLENGE_MAX_ATTEMPTS]);
      await client.query("COMMIT");
      committed = true;
      throw error;
    }

    const membership = await client.query<{ id: string }>(`
      SELECT id
      FROM organization_members
      WHERE user_id = $1 AND organization_id = $2
      FOR KEY SHARE
    `, [challenge.user_id, challenge.organization_id]);
    if (membership.rowCount !== 1) {
      await client.query(`UPDATE mobile_mfa_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [challenge.id]);
      await client.query("COMMIT");
      committed = true;
      throw new ApiError(403, "MOBILE_MEMBERSHIP_REVOKED", "تعذر إكمال تسجيل الدخول لهذه المساحة.");
    }

    const tokens = await issueMobileSession({
      userId: challenge.user_id,
      organizationId: challenge.organization_id,
      deviceId: challenge.device_id,
      deviceName: challenge.device_name ?? undefined,
      rememberSession: challenge.remember_session,
    });

    const consumed = await client.query(`
      UPDATE mobile_mfa_challenges
      SET used_at = now()
      WHERE id = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING id
    `, [challenge.id]);
    if (consumed.rowCount !== 1) throw new ApiError(401, "MFA_CHALLENGE_INVALID", "تعذر التحقق من طلب المصادقة.");
    await client.query("COMMIT");
    committed = true;

    return {
      tokens,
      userId: challenge.user_id,
      organizationId: challenge.organization_id,
    };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
