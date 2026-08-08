import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

function planUsesTrigramIndex(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record["Index Name"] === "messages_content_trgm_idx") return true;
  return Object.values(record).some((item) => Array.isArray(item)
    ? item.some(planUsesTrigramIndex)
    : planUsesTrigramIndex(item));
}

describeDatabase("chat substring search indexes", () => {
  let sql: Sql;
  const organizationId = randomUUID();

  beforeAll(() => {
    sql = createTestSqlClient(databaseUrl!, 1);
  });

  afterAll(async () => {
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    await sql.end({ timeout: 5 });
  });

  test("EXPLAIN ANALYZE can use the partial trigram index for message search", async () => {
    const userId = randomUUID();
    const agentId = randomUUID();
    const conversationId = randomUUID();
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, 'Search Plan', ${`search-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`search-${userId}@example.test`}, 'Search User')`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'owner')`;
    await sql`INSERT INTO agents (id, organization_id, name, status, current_version) VALUES (${agentId}, ${organizationId}, 'Search Agent', 'published', 1)`;
    await sql`INSERT INTO conversations (id, organization_id, agent_id, created_by_user_id, title) VALUES (${conversationId}, ${organizationId}, ${agentId}, ${userId}, 'Search Conversation')`;
    await sql.unsafe(`
      INSERT INTO messages (conversation_id, role, content, status, created_at)
      SELECT $1, 'user', CASE WHEN number % 137 = 0 THEN 'needle-production-search' ELSE md5(number::text) END, 'completed', now() - number * interval '1 second'
      FROM generate_series(1, 5000) AS number
    `, [conversationId]);
    await sql`ANALYZE messages`;

    const plan = await sql.begin(async (transaction) => {
      await transaction`SET LOCAL enable_seqscan = off`;
      const [row] = await transaction.unsafe<{ "QUERY PLAN": unknown }[]>(`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id FROM messages
        WHERE deleted_at IS NULL AND content ILIKE '%needle-production%'
      `);
      return row?.["QUERY PLAN"];
    });
    expect(planUsesTrigramIndex(plan)).toBe(true);
  });
});
