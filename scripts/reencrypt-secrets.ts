// Re-encrypts stored secrets with the active key using one short-lived node-postgres pool.
import { Pool, type PoolClient } from "pg";
import { decryptSecret, encryptSecret } from "../src/lib/security/encryption";

const databaseUrl = process.env.DATABASE_URL?.trim();
const currentKeyId = process.env.CREDENTIAL_ENCRYPTION_KEY_ID?.trim() || "primary";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!/^[A-Za-z0-9_-]{1,40}$/.test(currentKeyId)) throw new Error("CREDENTIAL_ENCRYPTION_KEY_ID is invalid.");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});
const currentPrefix = `v2.${currentKeyId}.`;
let rotated = 0;
let skipped = 0;

function replacement(envelope: string, context: string) {
  if (envelope.startsWith(currentPrefix)) {
    skipped += 1;
    return null;
  }
  const plaintext = decryptSecret(envelope, context);
  const next = encryptSecret(plaintext, context);
  if (decryptSecret(next, context) !== plaintext) throw new Error("REENCRYPTION_VERIFICATION_FAILED");
  return next;
}

async function transaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function audit(client: PoolClient, organizationId: string, resourceType: string, resourceId: string) {
  await client.query(
    `INSERT INTO audit_logs
      (organization_id, actor_type, action, resource_type, resource_id, metadata)
     VALUES ($1, 'system', 'secret.reencrypted', $2, $3, $4::jsonb)`,
    [organizationId, resourceType, resourceId, JSON.stringify({ keyId: currentKeyId })],
  );
}

async function rotateSimpleTable(input: {
  table: "provider_credentials" | "integrations" | "tool_approvals" | "agent_run_checkpoints";
  secretColumn: "encrypted_secret" | "encrypted_token" | "encrypted_arguments" | "encrypted_state";
  rows: Array<Record<string, string | null>>;
  context: (row: Record<string, string | null>) => string;
  resourceType: string;
}) {
  for (const row of input.rows) {
    const envelope = row[input.secretColumn];
    const id = row.id;
    const organizationId = row.organization_id;
    if (!envelope || !id || !organizationId) continue;
    const next = replacement(envelope, input.context(row));
    if (!next) continue;
    await transaction(async (client) => {
      const result = await client.query(
        `UPDATE ${input.table}
         SET ${input.secretColumn} = $1, updated_at = now()
         WHERE id = $2 AND organization_id = $3 AND ${input.secretColumn} = $4
         RETURNING id`,
        [next, id, organizationId, envelope],
      );
      if (result.rowCount) {
        await audit(client, organizationId, input.resourceType, id);
        rotated += 1;
      }
    });
  }
}

try {
  const providers = await pool.query<{ id: string; organization_id: string; encrypted_secret: string }>(
    "SELECT id, organization_id, encrypted_secret FROM provider_credentials ORDER BY id",
  );
  await rotateSimpleTable({
    table: "provider_credentials",
    secretColumn: "encrypted_secret",
    rows: providers.rows,
    context: (row) => `provider:${row.organization_id}`,
    resourceType: "provider_credential",
  });

  const integrations = await pool.query<{ id: string; organization_id: string; encrypted_token: string }>(
    "SELECT id, organization_id, encrypted_token FROM integrations ORDER BY id",
  );
  await rotateSimpleTable({
    table: "integrations",
    secretColumn: "encrypted_token",
    rows: integrations.rows,
    context: (row) => `integration:${row.organization_id}`,
    resourceType: "integration",
  });

  const servers = await pool.query<{
    id: string;
    organization_id: string;
    encrypted_bearer_token: string | null;
    encrypted_oauth_data: string | null;
  }>("SELECT id, organization_id, encrypted_bearer_token, encrypted_oauth_data FROM mcp_servers ORDER BY id");
  for (const row of servers.rows) {
    for (const field of ["encrypted_bearer_token", "encrypted_oauth_data"] as const) {
      const envelope = row[field];
      if (!envelope) continue;
      const context = field === "encrypted_bearer_token"
        ? `mcp:${row.organization_id}`
        : `mcp-oauth:${row.organization_id}`;
      const next = replacement(envelope, context);
      if (!next) continue;
      await transaction(async (client) => {
        const statement = field === "encrypted_bearer_token"
          ? `UPDATE mcp_servers SET encrypted_bearer_token = $1, updated_at = now()
             WHERE id = $2 AND organization_id = $3 AND encrypted_bearer_token = $4 RETURNING id`
          : `UPDATE mcp_servers SET encrypted_oauth_data = $1, updated_at = now()
             WHERE id = $2 AND organization_id = $3 AND encrypted_oauth_data = $4 RETURNING id`;
        const result = await client.query(statement, [next, row.id, row.organization_id, envelope]);
        if (result.rowCount) {
          await audit(client, row.organization_id, "mcp_server", row.id);
          rotated += 1;
        }
      });
    }
  }

  const approvals = await pool.query<{
    id: string;
    organization_id: string;
    run_id: string | null;
    encrypted_arguments: string;
  }>(`SELECT id, organization_id, run_id, encrypted_arguments
      FROM tool_approvals WHERE encrypted_arguments IS NOT NULL ORDER BY id`);
  await rotateSimpleTable({
    table: "tool_approvals",
    secretColumn: "encrypted_arguments",
    rows: approvals.rows,
    context: (row) => `approval:${row.organization_id}:${row.run_id}`,
    resourceType: "tool_approval",
  });

  const checkpoints = await pool.query<{
    id: string;
    organization_id: string;
    run_id: string;
    encrypted_state: string;
  }>("SELECT id, organization_id, run_id, encrypted_state FROM agent_run_checkpoints ORDER BY id");
  await rotateSimpleTable({
    table: "agent_run_checkpoints",
    secretColumn: "encrypted_state",
    rows: checkpoints.rows,
    context: (row) => `checkpoint:${row.organization_id}:${row.run_id}`,
    resourceType: "agent_run_checkpoint",
  });

  console.log(JSON.stringify({ level: "info", event: "secrets.reencrypted", keyId: currentKeyId, rotated, skipped }));
} finally {
  await pool.end();
}
