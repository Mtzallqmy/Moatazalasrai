import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resetEnvForTests } from "@/lib/config/env";
import {
  consumeWhatsAppConnectToken,
  createWhatsAppConnectLink,
  disconnectWhatsAppForUser,
  whatsappConnectionStatus,
} from "@/lib/integrations/whatsapp/linking";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("WhatsApp Business Platform persistence", () => {
  let sql: Sql;
  const organizationIds = new Set<string>();
  const userIds = new Set<string>();

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env.APP_URL = "https://app.example";
    process.env.PUBLIC_APP_URL = "https://app.example";
    process.env.WHATSAPP_INTEGRATION_ENABLED = "true";
    process.env.META_APP_ID = "123456";
    process.env.META_APP_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.META_GRAPH_API_VERSION = "v23.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token-that-is-long-enough";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "9876543210";
    process.env.WHATSAPP_DISPLAY_PHONE_NUMBER = "967700000000";
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-token-123456";
    process.env.WHATSAPP_CONNECT_TOKEN_SECRET = "connect-token-secret-32-characters-minimum";
    process.env.WHATSAPP_CONNECT_TOKEN_TTL_MINUTES = "10";
    resetEnvForTests();
    sql = postgres(databaseUrl!, { max: 3, prepare: false });
  });

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    }
    for (const userId of userIds) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
    }
    await sql.end({ timeout: 5 });
    resetEnvForTests();
  });

  async function seedUser(label: string) {
    const organizationId = randomUUID();
    const userId = randomUUID();
    organizationIds.add(organizationId);
    userIds.add(userId);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${label}, ${`wa-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`wa-${userId}@example.test`}, ${label})`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'member')`;
    return { organizationId, userId };
  }

  function tokenFromUrl(whatsappUrl: string) {
    const text = new URL(whatsappUrl).searchParams.get("text") ?? "";
    const [, token] = text.split(" ", 2);
    if (!token) throw new Error("CONNECT token missing from test URL");
    return token;
  }

  test("stores only a token HMAC, consumes once, links atomically, and disconnects", async () => {
    const tenant = await seedUser("WhatsApp Link Owner");
    const link = await createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() });
    const token = tokenFromUrl(link.whatsappUrl);
    const [stored] = await sql<{ token_hash: string; expires_at: Date }[]>`
      SELECT token_hash, expires_at FROM whatsapp_link_tokens WHERE user_id = ${tenant.userId} ORDER BY created_at DESC LIMIT 1
    `;
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.token_hash).not.toBe(token);
    expect(stored?.expires_at.getTime()).toBeGreaterThan(Date.now());

    const first = await consumeWhatsAppConnectToken({ token, waId: "967711111111", messageId: "wamid.link-1" });
    expect(first).toMatchObject({ ok: true, userId: tenant.userId });
    expect(await whatsappConnectionStatus(tenant.userId)).toMatchObject({ connected: true, phoneNumberMasked: "••••••1111" });

    const replay = await consumeWhatsAppConnectToken({ token, waId: "967711111111", messageId: "wamid.link-replay" });
    expect(replay).toEqual({ ok: false, reason: "invalid" });

    await disconnectWhatsAppForUser({ ...tenant, requestId: randomUUID() });
    expect(await whatsappConnectionStatus(tenant.userId)).toMatchObject({ connected: false, phoneNumberMasked: null });
  });

  test("serializes concurrent link creation so only one unused token remains active", async () => {
    const tenant = await seedUser("WhatsApp Concurrent Tokens");
    await Promise.all([
      createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() }),
      createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() }),
    ]);
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM whatsapp_link_tokens
      WHERE user_id = ${tenant.userId} AND used_at IS NULL AND revoked_at IS NULL
    `;
    expect(count).toBe(1);
  });

  test("atomically consumes a token once under concurrent delivery", async () => {
    const tenant = await seedUser("WhatsApp Concurrent Consume");
    const token = tokenFromUrl((await createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() })).whatsappUrl);
    const results = await Promise.all([
      consumeWhatsAppConnectToken({ token, waId: "967766666661", messageId: "wamid.concurrent-1" }),
      consumeWhatsAppConnectToken({ token, waId: "967766666662", messageId: "wamid.concurrent-2" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "invalid" }]);
  });

  test("revokes every previous unused token when a new link is created", async () => {
    const tenant = await seedUser("WhatsApp Token Rotation");
    const first = await createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() });
    const firstToken = tokenFromUrl(first.whatsappUrl);
    const second = await createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() });
    const secondToken = tokenFromUrl(second.whatsappUrl);

    expect(await consumeWhatsAppConnectToken({ token: firstToken, waId: "967744444444", messageId: "wamid.revoked" }))
      .toEqual({ ok: false, reason: "invalid" });
    expect(await consumeWhatsAppConnectToken({ token: secondToken, waId: "967744444444", messageId: "wamid.current" }))
      .toMatchObject({ ok: true, userId: tenant.userId });
  });

  test("relinking the same user updates one connection row instead of duplicating it", async () => {
    const tenant = await seedUser("WhatsApp Relink Owner");
    const firstToken = tokenFromUrl((await createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() })).whatsappUrl);
    expect(await consumeWhatsAppConnectToken({ token: firstToken, waId: "967755555555", messageId: "wamid.first-link" }))
      .toMatchObject({ ok: true });
    const secondToken = tokenFromUrl((await createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() })).whatsappUrl);
    expect(await consumeWhatsAppConnectToken({ token: secondToken, waId: "967755555555", messageId: "wamid.second-link" }))
      .toMatchObject({ ok: true });
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM whatsapp_connections WHERE user_id = ${tenant.userId}
    `;
    expect(count).toBe(1);
  });

  test("rejects an expired connect token", async () => {
    const tenant = await seedUser("Expired WhatsApp Token");
    const link = await createWhatsAppConnectLink({ ...tenant, requestId: randomUUID() });
    const token = tokenFromUrl(link.whatsappUrl);
    await sql`UPDATE whatsapp_link_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = ${tenant.userId}`;
    await expect(consumeWhatsAppConnectToken({ token, waId: "967722222222", messageId: "wamid.expired" }))
      .resolves.toEqual({ ok: false, reason: "invalid" });
  });

  test("prevents one wa_id from being linked to another user", async () => {
    const firstUser = await seedUser("WhatsApp First Owner");
    const secondUser = await seedUser("WhatsApp Second Owner");
    const firstToken = tokenFromUrl((await createWhatsAppConnectLink({ ...firstUser, requestId: randomUUID() })).whatsappUrl);
    const secondToken = tokenFromUrl((await createWhatsAppConnectLink({ ...secondUser, requestId: randomUUID() })).whatsappUrl);
    expect(await consumeWhatsAppConnectToken({ token: firstToken, waId: "967733333333", messageId: "wamid.owner" }))
      .toMatchObject({ ok: true, userId: firstUser.userId });
    expect(await consumeWhatsAppConnectToken({ token: secondToken, waId: "967733333333", messageId: "wamid.conflict" }))
      .toEqual({ ok: false, reason: "already_linked" });
  });

  test("enforces webhook message idempotency in PostgreSQL", async () => {
    const messageId = `wamid.${randomUUID()}`;
    await sql`
      INSERT INTO whatsapp_webhook_events (message_id, phone_number_id, event_type)
      VALUES (${messageId}, '1234567890', 'text')
    `;
    await expect(sql`
      INSERT INTO whatsapp_webhook_events (message_id, phone_number_id, event_type)
      VALUES (${messageId}, '1234567890', 'text')
    `).rejects.toMatchObject({ code: "23505" });
  });
});
