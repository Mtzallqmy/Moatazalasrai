import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

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

  afterAll(async () => {
    for (const organizationId of organizations) {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    }
    const { releaseWorkerUtils } = await import("@/worker/queue");
    await releaseWorkerUtils();
    await sql.end({ timeout: 5 });
  });

  async function createDocument(input: { text: string | null }) {
    const organizationId = randomUUID();
    organizations.add(organizationId);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${`Integration ${organizationId}`}, ${`it-${organizationId}`})`;
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

  test("document-parse worker task persists chunks before marking ready", async () => {
    const seeded = await createDocument({
      text: "هذا مستند اختبار إنتاجي. ".repeat(300),
    });
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
      queueName: "rag",
      jobKey,
      jobKeyMode: "unsafe_dedupe",
      maxAttempts: 2,
    });
    const second = await worker.addJob("document-parse", payload, {
      queueName: "rag",
      jobKey,
      jobKeyMode: "unsafe_dedupe",
      maxAttempts: 2,
    });
    expect(String(second.id)).toBe(String(first.id));
    const serialized = JSON.stringify(first.payload);
    expect(serialized).not.toMatch(/api[_-]?key|authorization|secret|password/i);
  });

  test("runtime migration exposes waiting_approval and tool idempotency constraints", async () => {
    const enumRows = await sql<{ enumlabel: string }[]>`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'run_status'
    `;
    expect(enumRows.map((row) => row.enumlabel)).toContain("waiting_approval");

    const indexRows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'mcp_tool_calls_run_tool_call_unique_idx',
          'agent_run_steps_run_number_unique_idx',
          'agent_team_runs_org_request_idx'
        )
    `;
    expect(new Set(indexRows.map((row) => row.indexname))).toEqual(new Set([
      "mcp_tool_calls_run_tool_call_unique_idx",
      "agent_run_steps_run_number_unique_idx",
      "agent_team_runs_org_request_idx",
    ]));
  });
});
