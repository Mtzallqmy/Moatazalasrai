import { randomUUID } from "node:crypto";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Puter client-executed chat persistence", () => {
  let sql: Sql;
  const organizations = new Set<string>();
  const users = new Set<string>();

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    sql = createTestSqlClient(databaseUrl!, 3);
  });

  afterAll(async () => {
    for (const organizationId of organizations) await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    for (const userId of users) await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end({ timeout: 5 });
  });

  async function seedTenant(label: string) {
    const organizationId = randomUUID(), userId = randomUUID(), credentialId = randomUUID(), agentId = randomUUID(), versionId = randomUUID();
    organizations.add(organizationId); users.add(userId);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${label}, ${`puter-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`puter-${userId}@example.test`}, ${label})`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'member')`;
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, provider_type_id, transport_mode, credential_mode, name, base_url, encrypted_secret,
        secret_hint, discovered_models, validation_status, enabled
      ) VALUES (
        ${credentialId}, ${organizationId}, 'openai', 'openai', 'direct', 'encrypted_byok', 'Existing Server Provider',
        'https://api.openai.com/v1', 'unchanged-existing-secret', 'test', ${sql.json(["existing-model"])}, 'verified', true
      )
    `;
    await sql`
      INSERT INTO agents (id, organization_id, name, status, current_version, default_provider_credential_id, default_model)
      VALUES (${agentId}, ${organizationId}, 'Puter Direct Chat Agent', 'published', 1, ${credentialId}, 'existing-model')
    `;
    await sql`
      INSERT INTO agent_versions (id, agent_id, version, provider_credential_id, model, instructions)
      VALUES (${versionId}, ${agentId}, 1, ${credentialId}, 'existing-model', 'أجب بالعربية دون أدوات خادمية.')
    `;
    return { organizationId, userId, agentId };
  }

  async function createConversation(fixture: Awaited<ReturnType<typeof seedTenant>>, title: string) {
    const conversationId = randomUUID();
    await sql`INSERT INTO conversations (id, organization_id, agent_id, title, created_by_user_id) VALUES (${conversationId}, ${fixture.organizationId}, ${fixture.agentId}, ${title}, ${fixture.userId})`;
    return conversationId;
  }

  test("isolates tenants, saves one completed reply, and rejects terminal replay", async () => {
    const owner = await seedTenant("Puter Owner");
    const other = await seedTenant("Puter Other");
    const conversationId = await createConversation(owner, "Completed Puter Chat");
    const { startPuterChat, finishPuterChat } = await import("@/lib/puter/server-runtime");
    const started = await startPuterChat({
      ...owner, role: "member", requestId: randomUUID(), conversationId, message: "اختبار Puter",
      model: "puter-model", clientRequestId: randomUUID(), attachmentIds: [],
    });

    await expect(finishPuterChat({ organizationId: other.organizationId, userId: other.userId, role: "member", requestId: randomUUID(), conversationId,
      executionId: started.executionId, userMessageId: started.userMessage.id, model: "puter-model", status: "completed", content: "رد غير مسموح" }))
      .rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    const finished = await finishPuterChat({ organizationId: owner.organizationId, userId: owner.userId, role: "member", requestId: randomUUID(), conversationId,
      executionId: started.executionId, userMessageId: started.userMessage.id, model: "puter-model", status: "completed", content: "رد Puter محفوظ" });
    expect(finished.assistantMessage).toMatchObject({ role: "assistant", content: "رد Puter محفوظ", model: "puter-model" });

    const saved = await sql<{ metadata: Record<string, unknown> }[]>`SELECT metadata FROM messages WHERE conversation_id = ${conversationId} AND role = 'assistant'`;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.metadata).toMatchObject({ provider: "puter", executionSource: "client", untrustedClientOutput: true });

    await expect(finishPuterChat({ organizationId: owner.organizationId, userId: owner.userId, role: "member", requestId: randomUUID(), conversationId,
      executionId: started.executionId, userMessageId: started.userMessage.id, model: "puter-model", status: "completed", content: "رد مكرر" }))
      .rejects.toMatchObject({ code: "PUTER_EXECUTION_TERMINAL" });
  });

  test.each(["failed", "cancelled"] as const)("persists %s without creating an assistant message", async (status) => {
    const fixture = await seedTenant(`Puter ${status}`);
    const conversationId = await createConversation(fixture, `Puter ${status}`);
    const { startPuterChat, finishPuterChat } = await import("@/lib/puter/server-runtime");
    const started = await startPuterChat({
      ...fixture, role: "member", requestId: randomUUID(), conversationId, message: `طلب ${status}`,
      model: "puter-model", clientRequestId: randomUUID(), attachmentIds: [],
    });
    const result = await finishPuterChat({ organizationId: fixture.organizationId, userId: fixture.userId, role: "member", requestId: randomUUID(), conversationId,
      executionId: started.executionId, userMessageId: started.userMessage.id, model: "puter-model", status });
    expect(result).toEqual({ status, assistantMessage: null });
    const [source] = await sql<{ metadata: Record<string, unknown> }[]>`SELECT metadata FROM messages WHERE id = ${started.userMessage.id}`;
    const [assistantCount] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM messages WHERE conversation_id = ${conversationId} AND role = 'assistant'`;
    expect(source?.metadata).toMatchObject({ clientExecutionStatus: status, provider: "puter", executionSource: "client" });
    expect(assistantCount?.count).toBe("0");
  });
});
