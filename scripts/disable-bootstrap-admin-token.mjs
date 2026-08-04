import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
try {
  await pool.query(`
    INSERT INTO bootstrap_admin_tokens (
      id, token_hash, permanently_disabled, disabled_at, updated_at
    ) VALUES ('admin', NULL, true, now(), now())
    ON CONFLICT (id) DO UPDATE SET
      token_hash = NULL,
      permanently_disabled = true,
      disabled_at = COALESCE(bootstrap_admin_tokens.disabled_at, now()),
      updated_at = now()
  `);
  console.log(JSON.stringify({ level: "info", event: "bootstrap.token.permanently_disabled" }));
} finally {
  await pool.end();
}
