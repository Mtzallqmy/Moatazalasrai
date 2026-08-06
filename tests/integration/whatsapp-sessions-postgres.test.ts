import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resetEnvForTests } from "@/lib/config/env";
import {
  advanceWhatsAppFlow,
  getOrCreateWhatsAppSession,
  startWhatsAppFlow,
  updateWhatsAppSession,
} from "@/lib/whatsapp/session-service";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("durable WhatsApp user sessions", () => {
  let sql: Sql;
  const organizationId = randomUUID();
  const userId = randomUUID();
  const waId = "967788888888";

  beforeAll(async () => {
    Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: databaseUrl! });
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    resetEnvForTests();
    sql = createTestSqlClient(databaseUrl!, 3);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, 'WhatsApp Session Org', ${`wa-session-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`wa-session-${userId}@example.test`}, 'WhatsApp Session User')`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'admin')`;
  });

  afterAll(async () => {
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end({ timeout: 5 });
    resetEnvForTests();
  });

  test("persists every flow step and rejects stale optimistic updates", async () => {
    const initial = await getOrCreateWhatsAppSession({ userId, organizationId, waId });
    const named = await startWhatsAppFlow({
      session: initial,
      flow: "agent.create",
      step: "name",
    });
    const described = await advanceWhatsAppFlow({
      session: named,
      step: "description",
      patch: { name: "مساعد المحتوى" },
    });
    expect(described.activeFlow).toBe("agent.create");
    expect(described.currentStep).toBe("description");
    expect(described.state).toMatchObject({ name: "مساعد المحتوى" });
    expect(described.version).toBeGreaterThan(initial.version);

    await expect(updateWhatsAppSession({
      session: named,
      currentStep: "instructions",
    })).rejects.toMatchObject({ code: "WHATSAPP_SESSION_CONFLICT" });
  });

  test("expires an abandoned flow without deleting the selected session identity", async () => {
    await sql`
      UPDATE whatsapp_user_sessions
      SET active_flow = 'agent.create', current_step = 'instructions', state = '{"name":"قديم"}'::jsonb,
          expires_at = now() - interval '1 minute'
      WHERE user_id = ${userId} AND organization_id = ${organizationId} AND whatsapp_wa_id = ${waId}
    `;
    const session = await getOrCreateWhatsAppSession({ userId, organizationId, waId });
    expect(session.activeFlow).toBeNull();
    expect(session.currentStep).toBeNull();
    expect(session.state).toEqual({});
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
