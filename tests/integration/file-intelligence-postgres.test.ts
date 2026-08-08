import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("File Intelligence PostgreSQL lifecycle", () => {
  let sql: Sql;
  const organizations = new Set<string>();

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.OBJECT_STORAGE_DRIVER = "database";
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    sql = createTestSqlClient(databaseUrl!, 3);
  });

  afterAll(async () => {
    for (const organizationId of organizations) await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    await sql.end({ timeout: 5 });
  });

  async function fixture() {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const credentialId = randomUUID();
    const agentId = randomUUID();
    const conversationId = randomUUID();
    organizations.add(organizationId);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${`Files ${organizationId}`}, ${`files-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`files-${userId}@example.test`}, 'File User')`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'owner')`;
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, provider_type_id, transport_mode, credential_mode, name, base_url,
        encrypted_secret, secret_hint, discovered_models, validation_status, enabled
      ) VALUES (
        ${credentialId}, ${organizationId}, 'openai', 'openai', 'direct', 'encrypted_byok', 'File Test Provider',
        'https://api.openai.com/v1', 'unused', 'test', ${sql.json(["test-model"])}, 'verified', true
      )
    `;
    await sql`
      INSERT INTO agents (id, organization_id, name, status, current_version, default_provider_credential_id, default_model)
      VALUES (${agentId}, ${organizationId}, 'File Agent', 'published', 1, ${credentialId}, 'test-model')
    `;
    await sql`
      INSERT INTO agent_versions (id, agent_id, version, provider_credential_id, model, instructions)
      VALUES (${randomUUID()}, ${agentId}, 1, ${credentialId}, 'test-model', 'Answer from user files when context is available.')
    `;
    await sql`
      INSERT INTO conversations (id, organization_id, agent_id, created_by_user_id, title)
      VALUES (${conversationId}, ${organizationId}, ${agentId}, ${userId}, 'File conversation')
    `;
    return { organizationId, userId, agentId, conversationId };
  }

  test("indexes an uploaded Markdown file and resolves it in later turns", async () => {
    const actor = await fixture();
    const { storeAttachment } = await import("@/lib/storage/attachments");
    const { resolveAttachmentContext } = await import("@/lib/storage/attachment-context-resolver");
    const uploaded = await storeAttachment({
      organizationId: actor.organizationId,
      conversationId: actor.conversationId,
      uploadedByUserId: actor.userId,
      source: "web",
      filename: "test.md",
      mimeType: "text/markdown",
      content: Buffer.from("# Secret Test\nThe internal validation code is FILE-78291."),
    });
    expect(uploaded.intelligenceStatus).toBe("ready");
    expect(uploaded.chunkCount).toBeGreaterThan(0);

    const explicit = await resolveAttachmentContext({
      organizationId: actor.organizationId,
      conversationId: actor.conversationId,
      userId: actor.userId,
      explicitAttachmentIds: [uploaded.id],
      userQuery: "What is the internal validation code in the attached file?",
    });
    expect(explicit.text).toContain("FILE-78291");
    expect(explicit.retrievedChunkCount).toBeGreaterThan(0);

    const messageId = randomUUID();
    await sql`
      INSERT INTO messages (id, conversation_id, role, author_user_id, content, status)
      VALUES (${messageId}, ${actor.conversationId}, 'user', ${actor.userId}, 'What is the code?', 'completed')
    `;
    await sql`UPDATE attachments SET message_id = ${messageId} WHERE id = ${uploaded.id}`;

    const followUp = await resolveAttachmentContext({
      organizationId: actor.organizationId,
      conversationId: actor.conversationId,
      userId: actor.userId,
      explicitAttachmentIds: [],
      userQuery: "What code did it mention?",
    });
    expect(followUp.text).toContain("FILE-78291");
    expect(followUp.attachments.map((file) => file.id)).toContain(uploaded.id);
  });

  test("does not resolve an attachment through a different conversation", async () => {
    const actor = await fixture();
    const otherConversationId = randomUUID();
    await sql`
      INSERT INTO conversations (id, organization_id, agent_id, created_by_user_id, title)
      VALUES (${otherConversationId}, ${actor.organizationId}, ${actor.agentId}, ${actor.userId}, 'Other conversation')
    `;
    const { storeAttachment } = await import("@/lib/storage/attachments");
    const { resolveAttachmentContext } = await import("@/lib/storage/attachment-context-resolver");
    const uploaded = await storeAttachment({
      organizationId: actor.organizationId,
      conversationId: actor.conversationId,
      uploadedByUserId: actor.userId,
      source: "web",
      filename: "private.txt",
      mimeType: "text/plain",
      content: Buffer.from("TENANT-SCOPED-CONTENT"),
    });
    await expect(resolveAttachmentContext({
      organizationId: actor.organizationId,
      conversationId: otherConversationId,
      userId: actor.userId,
      explicitAttachmentIds: [uploaded.id],
      userQuery: "read file",
    })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});
