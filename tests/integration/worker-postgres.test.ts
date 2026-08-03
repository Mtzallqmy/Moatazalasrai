import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const callRemoteMcpToolMock = vi.hoisted(() => vi.fn(async () => ({
  content: [{ type: "text", text: "remote result" }],
  isError: false,
})));

vi.mock("@/ai/mcp/client", () => ({ callRemoteMcpTool: callRemoteMcpToolMock }));

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Graphile Worker and PostgreSQL runtime", () => {
  let sql: Sql;
  const organizations = new Set<string>();

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env.AI_WORKER_ENABLED = "true";
    sql = postgres(databaseUrl!, { max: 3, prepare: false });
  });

  beforeEach(() => {
    callRemoteMcpToolMock.mockClear();
  });

  afterAll(async () => {
    for (const organizationId of organizations) {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    }
    const { releaseWorkerUtils } = await import("@/worker/queue");
    await releaseWorkerUtils();
    await sql.end({ timeout: 5 });
  });

  async function createOrganization() {
    const organizationId = randomUUID();
    organizations.add(organizationId);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${`Integration ${organizationId}`}, ${`it-${organizationId}`})`;
    return organizationId;
  }

  async function createDocument(input: { text: string | null }) {
    const organizationId = await createOrganization();
    const attachmentId = randomUUID();
    const checksum = randomUUID().replaceAll("-", "");
    await sql`
      INSERT INTO attachments (
        id, organization_id, source, filename, mime_type, size_bytes,
        sha256, content, processing_status, extracted_text
      ) VALUES (
        ${attachmentId}, ${organizationId}, 'web', 'document.txt', 'text/plain', 128,
        ${checksum}, ${Buffer.from(input.text ?? "empty")}, 'ready', ${input.text}
      )
    `;
    const knowledgeBaseId = randomUUID();
    await sql`INSERT INTO knowledge_bases (id, organization_id, name) VALUES (${knowledgeBaseId}, ${organizationId}, ${`KB ${knowledgeBaseId}`})`;
    const documentId = randomUUID();
    await sql`
      INSERT INTO knowledge_documents (
        id, organization_id, knowledge_base_id, attachment_id, title,
        mime_type, byte_size, checksum_sha256, status
      ) VALUES (
        ${documentId}, ${organizationId}, ${knowledgeBaseId}, ${attachmentId},
        'Document', 'text/plain', 128, ${checksum}, 'uploaded'
      )
    `;
    return { organizationId, documentId };
  }

  async function createMcpFixture() {
    const organizationId = await createOrganization();
    const credentialId = randomUUID();
    await sql`
      INSERT INTO provider_credentials (
        id, organization_id, provider, provider_type_id, transport_mode, credential_mode, name, base_url, encrypted_secret,
        secret_hint, discovered_models, validation_status, enabled
      ) VALUES (
        ${credentialId}, ${organizationId}, 'openai', 'openai', 'direct', 'encrypted_byok', 'Test Provider',
        'https://api.openai.com/v1', 'unused-in-mcp-test', 'test',
        ${sql.json(["test-model"])}, 'verified', true
      )
    `;
    const agentId = randomUUID();
    await sql`
      INSERT INTO agents (
        id, organization_id, name, status, current_version,
        default_provider_credential_id, default_model
      ) VALUES (
        ${agentId}, ${organizationId}, 'MCP Agent', 'published', 1,
        ${credentialId}, 'test-model'
      )
    `;
    const agentVersionId = randomUUID();
    await sql`
      INSERT INTO agent_versions (
        id, agent_id, version, provider_credential_id, model,
        instructions, temperature_milli, max_output_tokens
      ) VALUES (
        ${agentVersionId}, ${agentId}, 1, ${credentialId}, 'test-model',
        'Use the linked tool.', 0, 128
      )
    `;
    const conversationId = randomUUID();
    await sql`
      INSERT INTO conversations (id, organization_id, agent_id, title)
      VALUES (${conversationId}, ${organizationId}, ${agentId}, 'MCP Integration')
    `;
    const runId = randomUUID();
    await sql`
      INSERT INTO runs (
        id, organization_id, agent_id, agent_version_id, conversation_id,
        status, request_id, input, provider, model
      ) VALUES (
        ${runId}, ${organizationId}, ${agentId}, ${agentVersionId}, ${conversationId},
        'running', ${`mcp-${runId}`}, 'Run the tool', 'openai', 'test-model'
      )
    `;
    const serverId = randomUUID();
    await sql`
      INSERT INTO mcp_servers (
        id, organization_id, name, endpoint, auth_mode, enabled, status
      ) VALUES (
        ${serverId}, ${organizationId}, 'Test MCP', 'https://mcp.example.test/mcp',
        'bearer', true, 'connected'
      )
    `;
    const toolId = randomUUID();
    await sql`
      INSERT INTO mcp_tools (
        id, organization_id, server_id, name, input_schema, annotations,
        schema_hash, capability, enabled, risk
      ) VALUES (
        ${toolId}, ${organizationId}, ${serverId}, 'read_record',
        ${sql.json({ type: "object", properties: { id: { type: "string" } }, required: ["id"] })},
        ${sql.json({ readOnlyHint: true })}, 'schema-hash', 'read', true, 'low'
      )
    `;
    await sql`
      INSERT INTO agent_mcp_tools (
        organization_id, agent_id, tool_id, approval_mode, max_calls_per_run
      ) VALUES (${organizationId}, ${agentId}, ${toolId}, 'never', 1)
    `;
    return { organizationId, agentId, runId, serverId, toolId };
  }

  test("document-parse worker task persists chunks before marking ready", async () => {
    const seeded = await createDocument({ text: "هذا مستند اختبار إنتاجي. ".repeat(300) });
    const { documentParseTask } = await import("@/worker/tasks/document-parse");
    const helpers = {
      abortSignal: new AbortController().signal,
      logger: { info: () => undefined, error: () => undefined, debug: () => undefined, warn: () => undefined },
    } as unknown as Parameters<typeof documentParseTask>[1];
    await documentParseTask(seeded, helpers);

    const [document] = await sql<{ status: string; error_code: string | null }[]>`
      SELECT status, error_code FROM knowledge_documents
      WHERE id = ${seeded.documentId} AND organization_id = ${seeded.organizationId}
    `;
    const [countRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM knowledge_chunks
      WHERE document_id = ${seeded.documentId} AND organization_id = ${seeded.organizationId}
    `;
    expect(document?.status).toBe("ready");
    expect(document?.error_code).toBeNull();
    expect(Number(countRow?.count ?? 0)).toBeGreaterThan(0);
  });

  test("document-parse marks a document failed when extracted text is unavailable", async () => {
    const seeded = await createDocument({ text: null });
    const { documentParseTask } = await import("@/worker/tasks/document-parse");
    const helpers = {
      abortSignal: new AbortController().signal,
      logger: { info: () => undefined, error: () => undefined, debug: () => undefined, warn: () => undefined },
    } as unknown as Parameters<typeof documentParseTask>[1];
    await expect(documentParseTask(seeded, helpers)).rejects.toThrow();

    const [document] = await sql<{ status: string; error_code: string | null }[]>`
      SELECT status, error_code FROM knowledge_documents
      WHERE id = ${seeded.documentId} AND organization_id = ${seeded.organizationId}
    `;
    expect(document?.status).toBe("failed");
    expect(document?.error_code).toBe("DOCUMENT_TEXT_UNAVAILABLE");
  });

  test("Graphile job keys deduplicate payloads and queue data contains no credential", async () => {
    const { getWorkerUtils } = await import("@/worker/queue");
    const worker = await getWorkerUtils();
    const payload = { organizationId: randomUUID(), documentId: randomUUID() };
    const jobKey = `integration-document:${payload.documentId}`;
    const first = await worker.addJob("document-parse", payload, {
      queueName: "rag", jobKey, jobKeyMode: "unsafe_dedupe", maxAttempts: 2,
    });
    const second = await worker.addJob("document-parse", payload, {
      queueName: "rag", jobKey, jobKeyMode: "unsafe_dedupe", maxAttempts: 2,
    });
    expect(String(second.id)).toBe(String(first.id));
    expect(JSON.stringify(first.payload)).not.toMatch(/api[_-]?key|authorization|secret|password/i);
  });

  test("MCP toolCallId executes once and returns the stored result on retry", async () => {
    const seeded = await createMcpFixture();
    const { executeMcpToolIdempotent } = await import("@/ai/mcp/execution");
    const first = await executeMcpToolIdempotent({
      ...seeded,
      arguments: { id: "A" },
      toolCallId: "call-1",
      stepNumber: 1,
    });
    const second = await executeMcpToolIdempotent({
      ...seeded,
      arguments: { id: "A" },
      toolCallId: "call-1",
      stepNumber: 2,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(callRemoteMcpToolMock).toHaveBeenCalledTimes(1);
    const [stored] = await sql<{ status: string; error_code: string | null }[]>`
      SELECT status, error_code FROM mcp_tool_calls
      WHERE organization_id = ${seeded.organizationId} AND run_id = ${seeded.runId} AND tool_call_id = 'call-1'
    `;
    expect(stored?.status).toBe("completed");
    expect(stored?.error_code).toBeNull();
  });

  test("MCP rejects changed arguments for the same toolCallId", async () => {
    const seeded = await createMcpFixture();
    const { executeMcpToolIdempotent } = await import("@/ai/mcp/execution");
    await executeMcpToolIdempotent({ ...seeded, arguments: { id: "A" }, toolCallId: "call-conflict", stepNumber: 1 });
    await expect(executeMcpToolIdempotent({
      ...seeded,
      arguments: { id: "B" },
      toolCallId: "call-conflict",
      stepNumber: 2,
    })).rejects.toMatchObject({ code: "TOOL_CALL_IDEMPOTENCY_CONFLICT" });
    expect(callRemoteMcpToolMock).toHaveBeenCalledTimes(1);
  });

  test("MCP enforces the per-tool call limit and disabled server binding", async () => {
    const seeded = await createMcpFixture();
    const { executeMcpToolIdempotent } = await import("@/ai/mcp/execution");
    await executeMcpToolIdempotent({ ...seeded, arguments: { id: "A" }, toolCallId: "limit-1", stepNumber: 1 });
    await expect(executeMcpToolIdempotent({
      ...seeded,
      arguments: { id: "B" },
      toolCallId: "limit-2",
      stepNumber: 2,
    })).rejects.toMatchObject({ code: "TOOL_CALL_LIMIT_EXCEEDED" });

    await sql`UPDATE mcp_servers SET enabled = false WHERE id = ${seeded.serverId} AND organization_id = ${seeded.organizationId}`;
    await expect(executeMcpToolIdempotent({
      ...seeded,
      arguments: { id: "C" },
      toolCallId: "disabled-server",
      stepNumber: 3,
    })).rejects.toMatchObject({ code: "MCP_TOOL_NOT_LINKED" });
  });

  test("MCP hides tools not linked to the requested agent", async () => {
    const seeded = await createMcpFixture();
    const unlinkedAgentId = randomUUID();
    await sql`INSERT INTO agents (id, organization_id, name, status) VALUES (${unlinkedAgentId}, ${seeded.organizationId}, 'Unlinked Agent', 'published')`;
    const { executeMcpToolIdempotent } = await import("@/ai/mcp/execution");
    await expect(executeMcpToolIdempotent({
      ...seeded,
      agentId: unlinkedAgentId,
      arguments: { id: "A" },
      toolCallId: "unlinked",
      stepNumber: 1,
    })).rejects.toMatchObject({ code: "MCP_TOOL_NOT_LINKED" });
    expect(callRemoteMcpToolMock).not.toHaveBeenCalled();
  });

  test("runtime migration exposes approval and idempotency constraints", async () => {
    const enumRows = await sql<{ enumlabel: string }[]>`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'run_status'
    `;
    expect(enumRows.map((row) => row.enumlabel)).toContain("waiting_approval");

    const expected = [
      "mcp_tool_calls_run_tool_call_unique_idx",
      "agent_run_steps_run_number_unique_idx",
      "agent_team_runs_org_request_idx",
      "messages_conversation_client_request_unique_idx",
    ];
    const indexRows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY(${expected})
    `;
    expect(new Set(indexRows.map((row) => row.indexname))).toEqual(new Set(expected));
  });

  test("mobile refresh rotation allows only one concurrent consumer", async () => {
    const organizationId = await createOrganization();
    const userId = randomUUID();
    await sql`INSERT INTO users (id, email) VALUES (${userId}, ${`mobile-${userId}@example.test`})`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'member')`;
    const { issueMobileSession, rotateMobileSession } = await import("@/lib/auth/mobile");
    const initial = await issueMobileSession({ userId, organizationId, deviceId: `device-${userId}` });
    const results = await Promise.allSettled([
      rotateMobileSession(initial.refreshToken),
      rotateMobileSession(initial.refreshToken),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.objectContaining({ code: "REFRESH_TOKEN_REUSED" }) });
  });
});
