import { randomUUID } from "node:crypto";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Cloudflare provider platform persistence", () => {
  let sql: Sql;
  const organizationIds = new Set<string>();
  const userIds = new Set<string>();

  beforeAll(() => {
    sql = createTestSqlClient(databaseUrl!, 3);
  });

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    }
    for (const userId of userIds) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
    }
    await sql.end({ timeout: 5 });
  });

  async function seedTenant(label: string) {
    const organizationId = randomUUID();
    const userId = randomUUID();
    organizationIds.add(organizationId);
    userIds.add(userId);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${label}, ${`cf-provider-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`cf-provider-${userId}@example.test`}, ${label})`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'member')`;
    return { organizationId, userId };
  }

  async function seedProvider(organizationId: string, input: { name: string; isDefault?: boolean }) {
    const id = randomUUID();
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, provider_type_id, transport_mode, credential_mode,
        name, base_url, encrypted_secret, secret_hint, discovered_models,
        validation_status, health_status, enabled, is_default
      ) VALUES (
        ${id}, ${organizationId}, 'openai', 'openai', 'direct', 'encrypted_byok',
        ${input.name}, 'https://api.openai.com/v1', 'test-envelope', 'test',
        ${sql.json(["test-model"])}, 'verified', 'healthy', true, ${input.isDefault ?? false}
      )
    `;
    return id;
  }

  async function seedConversation(tenant: Awaited<ReturnType<typeof seedTenant>>) {
    const providerId = await seedProvider(tenant.organizationId, { name: `Provider ${randomUUID()}` });
    const agentId = randomUUID();
    const versionId = randomUUID();
    const conversationId = randomUUID();
    await sql`
      INSERT INTO agents (id, organization_id, name, status, current_version, default_provider_credential_id, default_model)
      VALUES (${agentId}, ${tenant.organizationId}, 'Cloudflare Test Agent', 'published', 1, ${providerId}, 'test-model')
    `;
    await sql`
      INSERT INTO agent_versions (id, agent_id, version, provider_credential_id, model, instructions)
      VALUES (${versionId}, ${agentId}, 1, ${providerId}, 'test-model', 'Test only')
    `;
    await sql`
      INSERT INTO conversations (
        id, organization_id, agent_id, title, status, created_by_user_id,
        provider_credential_id, model, last_message_at
      ) VALUES (
        ${conversationId}, ${tenant.organizationId}, ${agentId}, 'Cloudflare Conversation',
        'active', ${tenant.userId}, ${providerId}, 'test-model', now()
      )
    `;
    return { providerId, agentId, versionId, conversationId };
  }

  test("enforces one active default provider per organization", async () => {
    const tenant = await seedTenant("Default Provider Tenant");
    await seedProvider(tenant.organizationId, { name: "Primary", isDefault: true });
    await expect(seedProvider(tenant.organizationId, { name: "Duplicate", isDefault: true })).rejects.toMatchObject({ code: "23505" });
  });

  test("keeps archive, restore, and soft delete as separate states", async () => {
    const tenant = await seedTenant("Conversation Lifecycle Tenant");
    const fixture = await seedConversation(tenant);

    await sql`UPDATE conversations SET status = 'archived', archived_at = now() WHERE id = ${fixture.conversationId}`;
    let [row] = await sql<{ status: string; archived_at: Date | null; deleted_at: Date | null }[]>`
      SELECT status, archived_at, deleted_at FROM conversations WHERE id = ${fixture.conversationId}
    `;
    expect(row?.status).toBe("archived");
    expect(row?.archived_at).toBeInstanceOf(Date);
    expect(row?.deleted_at).toBeNull();

    await sql`UPDATE conversations SET status = 'active', archived_at = null WHERE id = ${fixture.conversationId}`;
    [row] = await sql<{ status: string; archived_at: Date | null; deleted_at: Date | null }[]>`
      SELECT status, archived_at, deleted_at FROM conversations WHERE id = ${fixture.conversationId}
    `;
    expect(row).toMatchObject({ status: "active", archived_at: null, deleted_at: null });

    await sql`UPDATE conversations SET status = 'deleted', deleted_at = now() WHERE id = ${fixture.conversationId}`;
    [row] = await sql<{ status: string; archived_at: Date | null; deleted_at: Date | null }[]>`
      SELECT status, archived_at, deleted_at FROM conversations WHERE id = ${fixture.conversationId}
    `;
    expect(row?.status).toBe("deleted");
    expect(row?.deleted_at).toBeInstanceOf(Date);
  });

  test("isolates conversation ownership and deduplicates message idempotency keys", async () => {
    const owner = await seedTenant("Conversation Owner");
    const other = await seedTenant("Other Tenant");
    const fixture = await seedConversation(owner);

    const ownedByOther = await sql<{ id: string }[]>`
      SELECT id FROM conversations
      WHERE id = ${fixture.conversationId}
        AND organization_id = ${other.organizationId}
        AND created_by_user_id = ${other.userId}
    `;
    expect(ownedByOther).toHaveLength(0);

    const idempotencyKey = randomUUID();
    await sql`
      INSERT INTO messages (conversation_id, role, content, status, client_request_id, completed_at)
      VALUES (${fixture.conversationId}, 'user', 'first', 'completed', ${idempotencyKey}, now())
    `;
    await expect(sql`
      INSERT INTO messages (conversation_id, role, content, status, client_request_id, completed_at)
      VALUES (${fixture.conversationId}, 'user', 'duplicate', 'completed', ${idempotencyKey}, now())
    `).rejects.toMatchObject({ code: "23505" });
  });

  test("stores provider failure as failed or interrupted, never completed", async () => {
    const tenant = await seedTenant("Failed Generation Tenant");
    const fixture = await seedConversation(tenant);
    const runId = randomUUID();
    await sql`
      INSERT INTO runs (
        id, organization_id, agent_id, agent_version_id, conversation_id, status,
        request_id, input, provider, model, error, error_code, completed_at
      ) VALUES (
        ${runId}, ${tenant.organizationId}, ${fixture.agentId}, ${fixture.versionId},
        ${fixture.conversationId}, 'failed', ${randomUUID()}, 'request', 'openai',
        'test-model', 'Provider failed', 'PROVIDER_TIMEOUT', now()
      )
    `;
    await sql`
      INSERT INTO messages (
        conversation_id, role, content, content_parts, status, client_request_id,
        provider_credential_id, model, error_code, completed_at
      ) VALUES (
        ${fixture.conversationId}, 'assistant', 'partial output',
        ${sql.json([{ type: "text", text: "partial output" }])}, 'interrupted',
        ${runId}, ${fixture.providerId}, 'test-model', 'PROVIDER_TIMEOUT', now()
      )
    `;
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM messages
      WHERE conversation_id = ${fixture.conversationId} AND role = 'assistant'
    `;
    expect(rows.map((row) => row.status)).toEqual(["interrupted"]);
    expect(rows.some((row) => row.status === "completed")).toBe(false);
  });
});
