import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("conversation member authorization", () => {
  let sql: Sql;
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const readerId = randomUUID();
  const writerId = randomUUID();
  const managerId = randomUUID();
  const outsiderId = randomUUID();
  const credentialId = randomUUID();
  const agentId = randomUUID();
  const versionId = randomUUID();
  const conversationId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    sql = postgres(databaseUrl!, { max: 3, prepare: false });
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, 'Conversation ACL', ${`conversation-acl-${organizationId}`})`;
    for (const [id, label] of [[ownerId, "owner"], [readerId, "reader"], [writerId, "writer"], [managerId, "manager"], [outsiderId, "outsider"]] as const) {
      await sql`INSERT INTO users (id, email, name) VALUES (${id}, ${`${label}-${id}@example.test`}, ${label})`;
      await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${id}, 'member')`;
    }
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, provider_type_id, transport_mode, credential_mode, name, base_url,
        encrypted_secret, secret_hint, discovered_models, validation_status, enabled
      ) VALUES (
        ${credentialId}, ${organizationId}, 'openai', 'openai', 'direct', 'encrypted_byok', 'Conversation ACL Provider',
        'https://api.openai.com/v1', 'encrypted-test-secret', 'test', ${sql.json(["test-model"])}, 'verified', true
      )
    `;
    await sql`
      INSERT INTO agents (id, organization_id, name, status, current_version, default_provider_credential_id, default_model)
      VALUES (${agentId}, ${organizationId}, 'Conversation ACL Agent', 'published', 1, ${credentialId}, 'test-model')
    `;
    await sql`
      INSERT INTO agent_versions (id, agent_id, version, provider_credential_id, model, instructions)
      VALUES (${versionId}, ${agentId}, 1, ${credentialId}, 'test-model', 'test')
    `;
    await sql`
      INSERT INTO conversations (id, organization_id, agent_id, title, created_by_user_id)
      VALUES (${conversationId}, ${organizationId}, ${agentId}, 'Shared conversation', ${ownerId})
    `;
    await sql`
      INSERT INTO conversation_members (organization_id, conversation_id, user_id, role, added_by_user_id)
      VALUES
        (${organizationId}, ${conversationId}, ${ownerId}, 'manager', ${ownerId}),
        (${organizationId}, ${conversationId}, ${readerId}, 'reader', ${ownerId}),
        (${organizationId}, ${conversationId}, ${writerId}, 'writer', ${ownerId}),
        (${organizationId}, ${conversationId}, ${managerId}, 'manager', ${ownerId})
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    for (const id of [ownerId, readerId, writerId, managerId, outsiderId]) await sql`DELETE FROM users WHERE id = ${id}`;
    await sql.end({ timeout: 5 });
  });

  test("enforces reader, writer, manager, and outsider access", async () => {
    const { requireConversationAccess } = await import("@/lib/chat/access");
    await expect(requireConversationAccess({ organizationId, conversationId, userId: readerId, role: "member", access: "read" })).resolves.toMatchObject({ id: conversationId });
    await expect(requireConversationAccess({ organizationId, conversationId, userId: readerId, role: "member", access: "write" })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(requireConversationAccess({ organizationId, conversationId, userId: writerId, role: "member", access: "write" })).resolves.toMatchObject({ id: conversationId });
    await expect(requireConversationAccess({ organizationId, conversationId, userId: writerId, role: "member", access: "manage" })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(requireConversationAccess({ organizationId, conversationId, userId: managerId, role: "member", access: "manage" })).resolves.toMatchObject({ id: conversationId });
    await expect(requireConversationAccess({ organizationId, conversationId, userId: outsiderId, role: "member", access: "read" })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });

  test("keeps one membership row per conversation and user", async () => {
    await expect(sql`
      INSERT INTO conversation_members (organization_id, conversation_id, user_id, role)
      VALUES (${organizationId}, ${conversationId}, ${writerId}, 'reader')
    `).rejects.toMatchObject({ code: "23505" });
  });
});
