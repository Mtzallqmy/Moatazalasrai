import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

type RuntimeContext = {
  organizationId?: string;
  userId?: string;
  bypass?: boolean;
};

describeDatabase("PostgreSQL row-level tenant isolation", () => {
  let pool: Pool;
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const agentA = randomUUID();
  const agentB = randomUUID();
  const conversationA = randomUUID();
  const conversationB = randomUUID();

  async function withRuntimeContext<T>(
    context: RuntimeContext,
    action: (client: PoolClient) => Promise<T>,
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE moataz_app_runtime");
      await client.query(
        `SELECT
          set_config('app.rls_bypass', $1, true),
          set_config('app.current_organization_id', $2, true),
          set_config('app.current_user_id', $3, true)`,
        [
          context.bypass ? "on" : "off",
          context.organizationId ?? "",
          context.userId ?? "",
        ],
      );
      return await action(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 4 });
    await pool.query(
      `INSERT INTO organizations (id, name, slug) VALUES
        ($1, 'RLS Organization A', $2),
        ($3, 'RLS Organization B', $4)`,
      [organizationA, `rls-a-${organizationA}`, organizationB, `rls-b-${organizationB}`],
    );
    await pool.query(
      `INSERT INTO users (id, email) VALUES
        ($1, $2),
        ($3, $4)`,
      [userA, `rls-a-${userA}@example.test`, userB, `rls-b-${userB}@example.test`],
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES
        ($1, $2, 'owner'),
        ($3, $4, 'owner')`,
      [organizationA, userA, organizationB, userB],
    );
    await pool.query(
      `INSERT INTO agents (id, organization_id, name, status) VALUES
        ($1, $2, 'Agent A', 'published'),
        ($3, $4, 'Agent B', 'published')`,
      [agentA, organizationA, agentB, organizationB],
    );
    await pool.query(
      `INSERT INTO conversations (id, organization_id, agent_id, title) VALUES
        ($1, $2, $3, 'Conversation A'),
        ($4, $5, $6, 'Conversation B')`,
      [conversationA, organizationA, agentA, conversationB, organizationB, agentB],
    );
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES
        ($1, 'user', 'Message A'),
        ($2, 'user', 'Message B')`,
      [conversationA, conversationB],
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[organizationA, organizationB]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
    await pool.end();
  });

  test("enables and forces RLS on every organization-scoped table", async () => {
    const result = await pool.query<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policy_count: string;
    }>(`
      SELECT
        c.table_name,
        cls.relrowsecurity AS rls_enabled,
        cls.relforcerowsecurity AS rls_forced,
        count(p.policyname)::text AS policy_count
      FROM information_schema.columns c
      JOIN pg_class cls ON cls.relname = c.table_name
      JOIN pg_namespace n ON n.oid = cls.relnamespace AND n.nspname = c.table_schema
      LEFT JOIN pg_policies p ON p.schemaname = c.table_schema AND p.tablename = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
      GROUP BY c.table_name, cls.relrowsecurity, cls.relforcerowsecurity
      ORDER BY c.table_name
    `);
    expect(result.rows.length).toBeGreaterThan(40);
    expect(result.rows.every((row) => row.rls_enabled && row.rls_forced)).toBe(true);
    expect(result.rows.every((row) => Number(row.policy_count) >= 1)).toBe(true);
  });

  test("creates a leading organization index for every organization-scoped table", async () => {
    const result = await pool.query<{ table_name: string }>(`
      SELECT c.table_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.column_name = 'organization_id'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          JOIN pg_class t ON t.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public'
            AND t.relname = c.table_name
            AND (i.indkey::smallint[])[0] = (
              SELECT a.attnum
              FROM pg_attribute a
              WHERE a.attrelid = t.oid AND a.attname = 'organization_id'
            )
        )
      ORDER BY c.table_name
    `);
    expect(result.rows).toEqual([]);
  });

  test("fails closed when no tenant or bypass context is present", async () => {
    const count = await withRuntimeContext({}, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM agents WHERE id = ANY($1::uuid[])",
        [[agentA, agentB]],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
    expect(count).toBe(0);
  });

  test("allows a tenant to see and mutate only its own rows", async () => {
    await withRuntimeContext({ organizationId: organizationA, userId: userA }, async (client) => {
      const agents = await client.query<{ id: string }>(
        "SELECT id FROM agents WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[agentA, agentB]],
      );
      expect(agents.rows.map((row) => row.id)).toEqual([agentA]);

      const messages = await client.query<{ content: string }>(
        "SELECT content FROM messages WHERE conversation_id = ANY($1::uuid[]) ORDER BY content",
        [[conversationA, conversationB]],
      );
      expect(messages.rows.map((row) => row.content)).toEqual(["Message A"]);

      const updated = await client.query(
        "UPDATE agents SET name = 'Cross-tenant update' WHERE id = $1",
        [agentB],
      );
      expect(updated.rowCount).toBe(0);

      await expect(client.query(
        "INSERT INTO agents (organization_id, name, status) VALUES ($1, 'Forbidden', 'draft')",
        [organizationB],
      )).rejects.toMatchObject({ code: "42501" });
    });
  });

  test("user scope exposes only memberships and organizations belonging to that user", async () => {
    await withRuntimeContext({ userId: userA }, async (client) => {
      const memberships = await client.query<{ organization_id: string; user_id: string }>(
        "SELECT organization_id, user_id FROM organization_members WHERE user_id = ANY($1::uuid[])",
        [[userA, userB]],
      );
      expect(memberships.rows).toEqual([{ organization_id: organizationA, user_id: userA }]);

      const organizations = await client.query<{ id: string }>(
        "SELECT id FROM organizations WHERE id = ANY($1::uuid[])",
        [[organizationA, organizationB]],
      );
      expect(organizations.rows).toEqual([{ id: organizationA }]);
    });
  });

  test("explicit system bypass is the only context that can read both tenants", async () => {
    const ids = await withRuntimeContext({ bypass: true }, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM agents WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[agentA, agentB]],
      );
      return result.rows.map((row) => row.id);
    });
    expect(new Set(ids)).toEqual(new Set([agentA, agentB]));
  });

  test("grants the runtime role access to Graphile Worker after its migrations", async () => {
    const result = await pool.query<{
      schema_usage: boolean;
      jobs_select: boolean;
    }>(`
      SELECT
        has_schema_privilege('moataz_app_runtime', 'graphile_worker', 'USAGE') AS schema_usage,
        has_table_privilege('moataz_app_runtime', 'graphile_worker._private_jobs', 'SELECT') AS jobs_select
    `);
    expect(result.rows[0]).toEqual({ schema_usage: true, jobs_select: true });
  });
});
