import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("security hardening persistence", () => {
  let sql: Sql;
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env.CREDENTIAL_ENCRYPTION_KEY_ID ??= "test";
    sql = createTestSqlClient(databaseUrl!, 2);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, 'Security test', ${`security-${organizationId}`})`;
    await sql`INSERT INTO users (id, email) VALUES (${userId}, ${`security-${userId}@example.test`})`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'owner')`;
    await sql`
      INSERT INTO sessions (id, user_id, active_organization_id, token_hash, expires_at)
      VALUES (${sessionId}, ${userId}, ${organizationId}, ${`token-${sessionId}`}, now() + interval '1 day')
    `;
    await sql`
      INSERT INTO user_totp_factors (user_id, encrypted_secret, verified_at)
      VALUES (${userId}, 'test-encrypted-secret', now())
    `;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  test("blocks an owner sensitive action until the current session completes MFA", async () => {
    const { assertFreshMfa } = await import("@/lib/auth/mfa");
    await expect(assertFreshMfa({
      userId,
      sessionId,
      role: "owner",
      permission: "providers:manage",
    })).rejects.toMatchObject({ code: "MFA_REQUIRED" });

    await sql`
      INSERT INTO mfa_session_verifications (user_id, session_id, method, expires_at)
      VALUES (${userId}, ${sessionId}, 'totp', now() + interval '12 hours')
    `;
    await expect(assertFreshMfa({
      userId,
      sessionId,
      role: "owner",
      permission: "providers:manage",
    })).resolves.toBeUndefined();
  });

  test("rejects modification and deletion of audit records", async () => {
    const auditId = randomUUID();
    await sql`
      INSERT INTO audit_logs (id, organization_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
      VALUES (${auditId}, ${organizationId}, 'test', ${userId}, 'security.test', 'test', ${auditId}, '{}'::jsonb)
    `;
    await expect(sql`UPDATE audit_logs SET action = 'tampered' WHERE id = ${auditId}`)
      .rejects.toMatchObject({ message: expect.stringContaining("audit_logs is append-only") });
    await expect(sql`DELETE FROM audit_logs WHERE id = ${auditId}`)
      .rejects.toMatchObject({ message: expect.stringContaining("audit_logs is append-only") });
  });
});
