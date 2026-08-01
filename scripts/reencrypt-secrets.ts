import postgres from "postgres";
import { decryptSecret, encryptSecret } from "../src/lib/security/encryption";

const databaseUrl = process.env.DATABASE_URL?.trim();
const currentKeyId = process.env.CREDENTIAL_ENCRYPTION_KEY_ID?.trim() || "primary";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!/^[A-Za-z0-9_-]{1,40}$/.test(currentKeyId)) throw new Error("CREDENTIAL_ENCRYPTION_KEY_ID is invalid.");

const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
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

async function audit(
  tx: postgres.TransactionSql,
  organizationId: string,
  resourceType: string,
  resourceId: string,
) {
  await tx`
    INSERT INTO audit_logs (organization_id, actor_type, action, resource_type, resource_id, metadata)
    VALUES (${organizationId}, 'system', 'secret.reencrypted', ${resourceType}, ${resourceId}, ${tx.json({ keyId: currentKeyId })})
  `;
}

try {
  const providers = await sql<{ id: string; organization_id: string; encrypted_secret: string }[]>`
    SELECT id, organization_id, encrypted_secret FROM provider_credentials ORDER BY id
  `;
  for (const row of providers) {
    const next = replacement(row.encrypted_secret, `provider:${row.organization_id}`);
    if (!next) continue;
    await sql.begin(async (tx) => {
      const changed = await tx`
        UPDATE provider_credentials SET encrypted_secret = ${next}, updated_at = now()
        WHERE id = ${row.id} AND organization_id = ${row.organization_id} AND encrypted_secret = ${row.encrypted_secret}
        RETURNING id
      `;
      if (changed.length) { await audit(tx, row.organization_id, "provider_credential", row.id); rotated += 1; }
    });
  }

  const integrations = await sql<{ id: string; organization_id: string; encrypted_token: string }[]>`
    SELECT id, organization_id, encrypted_token FROM integrations ORDER BY id
  `;
  for (const row of integrations) {
    const next = replacement(row.encrypted_token, `integration:${row.organization_id}`);
    if (!next) continue;
    await sql.begin(async (tx) => {
      const changed = await tx`
        UPDATE integrations SET encrypted_token = ${next}, updated_at = now()
        WHERE id = ${row.id} AND organization_id = ${row.organization_id} AND encrypted_token = ${row.encrypted_token}
        RETURNING id
      `;
      if (changed.length) { await audit(tx, row.organization_id, "integration", row.id); rotated += 1; }
    });
  }

  const servers = await sql<{ id: string; organization_id: string; encrypted_bearer_token: string | null; encrypted_oauth_data: string | null }[]>`
    SELECT id, organization_id, encrypted_bearer_token, encrypted_oauth_data FROM mcp_servers ORDER BY id
  `;
  for (const row of servers) {
    for (const field of ["encrypted_bearer_token", "encrypted_oauth_data"] as const) {
      const envelope = row[field];
      if (!envelope) continue;
      const context = field === "encrypted_bearer_token" ? `mcp:${row.organization_id}` : `mcp-oauth:${row.organization_id}`;
      const next = replacement(envelope, context);
      if (!next) continue;
      await sql.begin(async (tx) => {
        const changed = field === "encrypted_bearer_token"
          ? await tx`UPDATE mcp_servers SET encrypted_bearer_token = ${next}, updated_at = now() WHERE id = ${row.id} AND organization_id = ${row.organization_id} AND encrypted_bearer_token = ${envelope} RETURNING id`
          : await tx`UPDATE mcp_servers SET encrypted_oauth_data = ${next}, updated_at = now() WHERE id = ${row.id} AND organization_id = ${row.organization_id} AND encrypted_oauth_data = ${envelope} RETURNING id`;
        if (changed.length) { await audit(tx, row.organization_id, "mcp_server", row.id); rotated += 1; }
      });
    }
  }

  const approvals = await sql<{ id: string; organization_id: string; run_id: string | null; encrypted_arguments: string }[]>`
    SELECT id, organization_id, run_id, encrypted_arguments FROM tool_approvals
    WHERE encrypted_arguments IS NOT NULL ORDER BY id
  `;
  for (const row of approvals) {
    const next = replacement(row.encrypted_arguments, `approval:${row.organization_id}:${row.run_id}`);
    if (!next) continue;
    await sql.begin(async (tx) => {
      const changed = await tx`UPDATE tool_approvals SET encrypted_arguments = ${next}, updated_at = now() WHERE id = ${row.id} AND organization_id = ${row.organization_id} AND encrypted_arguments = ${row.encrypted_arguments} RETURNING id`;
      if (changed.length) { await audit(tx, row.organization_id, "tool_approval", row.id); rotated += 1; }
    });
  }

  const checkpoints = await sql<{ id: string; organization_id: string; run_id: string; encrypted_state: string }[]>`
    SELECT id, organization_id, run_id, encrypted_state FROM agent_run_checkpoints ORDER BY id
  `;
  for (const row of checkpoints) {
    const next = replacement(row.encrypted_state, `checkpoint:${row.organization_id}:${row.run_id}`);
    if (!next) continue;
    await sql.begin(async (tx) => {
      const changed = await tx`UPDATE agent_run_checkpoints SET encrypted_state = ${next}, updated_at = now() WHERE id = ${row.id} AND organization_id = ${row.organization_id} AND encrypted_state = ${row.encrypted_state} RETURNING id`;
      if (changed.length) { await audit(tx, row.organization_id, "agent_run_checkpoint", row.id); rotated += 1; }
    });
  }

  console.log(JSON.stringify({ level: "info", event: "secrets.reencrypted", keyId: currentKeyId, rotated, skipped }));
} finally {
  await sql.end({ timeout: 5 });
}
