import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;
const PASSWORD = "Correct-Horse-42!";
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

type LoginPayload = {
  success: boolean;
  data?: {
    tokens?: { accessToken: string; refreshToken: string };
    mfaRequired?: boolean;
    challengeToken?: string;
    expiresAt?: string;
  };
  error?: { code?: string };
};

describeDatabase("mobile MFA authentication on PostgreSQL", () => {
  let sql: Sql;
  const userIds = new Set<string>();
  const organizationIds = new Set<string>();

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env.CREDENTIAL_ENCRYPTION_KEY_ID = "integration";
    process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS = "{}";
    process.env.TRUST_PROXY_HEADERS = "false";
    sql = createTestSqlClient(databaseUrl!, 6);
  });

  afterAll(async () => {
    for (const userId of userIds) await sql`DELETE FROM users WHERE id = ${userId}`;
    for (const organizationId of organizationIds) await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    await sql.end({ timeout: 5 });
  });

  async function fixture(input: { mfa: boolean; recoveryCode?: string }) {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const deviceId = `device-${randomUUID()}`;
    const email = `mobile-mfa-${userId}@example.test`;
    organizationIds.add(organizationId);
    userIds.add(userId);
    const { hashPassword } = await import("@/lib/auth/password");
    const passwordHash = await hashPassword(PASSWORD);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${`Mobile MFA ${organizationId}`}, ${`mobile-mfa-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name, password_hash) VALUES (${userId}, ${email}, 'Mobile MFA User', ${passwordHash})`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'member')`;
    if (input.mfa) {
      const { encryptSecret } = await import("@/lib/security/encryption");
      const { hashRecoveryCode } = await import("@/lib/security/totp");
      const recoveryHashes = input.recoveryCode ? [hashRecoveryCode(input.recoveryCode)] : [];
      await sql`
        INSERT INTO user_mfa_credentials (
          user_id, encrypted_secret, secret_hint, enabled, enabled_at,
          last_used_step, recovery_code_hashes, failed_attempts
        ) VALUES (
          ${userId}, ${encryptSecret(SECRET, `mfa:${userId}`)}, 'OJQG', true, now(),
          NULL, ${sql.json(recoveryHashes)}, 0
        )
      `;
    }
    return { organizationId, userId, deviceId, email };
  }

  async function login(f: Awaited<ReturnType<typeof fixture>>) {
    const { POST } = await import("@/app/api/mobile/v1/auth/login/route");
    const request = new Request("http://localhost/api/mobile/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": randomUUID() },
      body: JSON.stringify({
        email: f.email,
        password: PASSWORD,
        organizationId: f.organizationId,
        deviceId: f.deviceId,
        deviceName: "Integration Device",
        rememberSession: true,
      }),
    });
    const response = await POST(request);
    return { response, payload: await response.json() as LoginPayload };
  }

  async function verify(challengeToken: string, code: string) {
    const { POST } = await import("@/app/api/mobile/v1/auth/mfa/verify/route");
    const request = new Request("http://localhost/api/mobile/v1/auth/mfa/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": randomUUID() },
      body: JSON.stringify({ challengeToken, code }),
    });
    const response = await POST(request);
    return { response, payload: await response.json() as LoginPayload };
  }

  test("MFA disabled + correct password issues a mobile session", async () => {
    const f = await fixture({ mfa: false });
    const result = await login(f);
    expect(result.response.status).toBe(200);
    expect(result.payload.data?.tokens?.accessToken).toMatch(/^mat_/);
    expect(result.payload.data?.tokens?.refreshToken).toMatch(/^mrt_/);
  });

  test("mobile login must never issue tokens before MFA verification", async () => {
    const f = await fixture({ mfa: true });
    const result = await login(f);
    expect(result.response.status).toBe(202);
    expect(result.payload.data).toMatchObject({ mfaRequired: true });
    expect(result.payload.data?.challengeToken).toMatch(/^mmc_/);
    expect(result.payload.data).not.toHaveProperty("tokens");
    const [count] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM mobile_sessions WHERE user_id = ${f.userId}`;
    expect(Number(count?.count ?? 0)).toBe(0);
  });

  test("MFA enabled + correct TOTP verifies challenge and issues tokens", async () => {
    const f = await fixture({ mfa: true });
    const first = await login(f);
    const { totpCode } = await import("@/lib/security/totp");
    const second = await verify(first.payload.data!.challengeToken!, totpCode(SECRET));
    expect(second.response.status).toBe(200);
    expect(second.payload.data?.tokens?.accessToken).toMatch(/^mat_/);
    const [count] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM mobile_sessions WHERE user_id = ${f.userId}`;
    expect(Number(count?.count ?? 0)).toBe(1);
  });

  test("MFA enabled + wrong TOTP is denied without a mobile session", async () => {
    const f = await fixture({ mfa: true });
    const first = await login(f);
    const denied = await verify(first.payload.data!.challengeToken!, "000000");
    expect(denied.response.status).toBe(401);
    expect(denied.payload.error?.code).toBe("MFA_CODE_INVALID");
    const [count] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM mobile_sessions WHERE user_id = ${f.userId}`;
    expect(Number(count?.count ?? 0)).toBe(0);
  });

  test("expired MFA challenge is denied", async () => {
    const f = await fixture({ mfa: true });
    const first = await login(f);
    await sql`UPDATE mobile_mfa_challenges SET expires_at = now() - interval '1 second' WHERE user_id = ${f.userId}`;
    const { totpCode } = await import("@/lib/security/totp");
    const denied = await verify(first.payload.data!.challengeToken!, totpCode(SECRET));
    expect(denied.response.status).toBe(401);
    expect(denied.payload.error?.code).toBe("MFA_CHALLENGE_EXPIRED");
  });

  test("used MFA challenge cannot be replayed", async () => {
    const f = await fixture({ mfa: true });
    const first = await login(f);
    const { totpCode } = await import("@/lib/security/totp");
    const code = totpCode(SECRET);
    const accepted = await verify(first.payload.data!.challengeToken!, code);
    expect(accepted.response.status).toBe(200);
    const replay = await verify(first.payload.data!.challengeToken!, code);
    expect(replay.response.status).toBe(401);
    expect(replay.payload.error?.code).toBe("MFA_CHALLENGE_USED");
  });

  test("valid recovery code succeeds exactly once", async () => {
    const recoveryCode = "ABCD-EF12-3456-7890";
    const f = await fixture({ mfa: true, recoveryCode });
    const first = await login(f);
    const accepted = await verify(first.payload.data!.challengeToken!, recoveryCode);
    expect(accepted.response.status).toBe(200);
    expect(accepted.payload.data?.tokens?.accessToken).toMatch(/^mat_/);

    const next = await login(f);
    const denied = await verify(next.payload.data!.challengeToken!, recoveryCode);
    expect(denied.response.status).toBe(401);
    expect(denied.payload.error?.code).toBe("MFA_CODE_INVALID");
  });

  test("challenge cannot issue a stale session after tenant membership revocation", async () => {
    const f = await fixture({ mfa: true });
    const first = await login(f);
    await sql`DELETE FROM organization_members WHERE organization_id = ${f.organizationId} AND user_id = ${f.userId}`;
    const { totpCode } = await import("@/lib/security/totp");
    const denied = await verify(first.payload.data!.challengeToken!, totpCode(SECRET));
    expect(denied.response.status).toBe(403);
    expect(denied.payload.error?.code).toBe("MOBILE_MEMBERSHIP_REVOKED");
    const [count] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM mobile_sessions WHERE user_id = ${f.userId}`;
    expect(Number(count?.count ?? 0)).toBe(0);
  });
});
