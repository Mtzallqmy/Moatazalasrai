import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestSqlClient, type Sql } from "../helpers/pg-sql";
import { listOrganizationMcpCatalog } from "@/lib/mcp/application-service";
import { listOrganizationSiteConnections } from "@/lib/site-connections/application-service";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("channel integration application services", () => {
  let sql: Sql;
  const organizationId = randomUUID();
  const userId = randomUUID();
  const serverId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.BROWSER_AGENT_ENABLED = "true";
    sql = createTestSqlClient(databaseUrl!, 3);
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, 'Channel Integrations Test', ${`channel-integrations-${organizationId}`})`;
    await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`channel-integrations-${userId}@example.test`}, 'Integration Admin')`;
    await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${organizationId}, ${userId}, 'admin')`;
    await sql`
      INSERT INTO mcp_servers (id, organization_id, name, url, auth_type, enabled)
      VALUES (${serverId}, ${organizationId}, 'Postgres MCP', 'https://mcp.example.test/mcp', 'none', true)
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end({ timeout: 5 });
  });

  test("returns the real MCP server without secret fields", async () => {
    const catalog = await listOrganizationMcpCatalog({ organizationId, userId });
    const server = catalog.find((item) => item.id === serverId);
    expect(server).toMatchObject({
      id: serverId,
      name: "Postgres MCP",
      url: "https://mcp.example.test/mcp",
      authType: "none",
      enabled: true,
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
    });
    expect(server).not.toHaveProperty("encryptedBearerToken");
    expect(JSON.stringify(server)).not.toContain("bearerToken");
  });

  test("reads site connections through the same application service and preserves tenant isolation", async () => {
    const connections = await listOrganizationSiteConnections({ organizationId, userId });
    expect(connections).toEqual([]);
  });
});
