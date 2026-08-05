// Container healthcheck: verifies PostgreSQL reachability and a recent live worker heartbeat.
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required for the worker healthcheck.");

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3_000 });
try {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM worker_heartbeats
      WHERE stopping_at IS NULL
        AND last_seen_at >= now() - interval '90 seconds'
    ) AS active
  `);
  if (result.rows[0]?.active !== true) {
    throw new Error("No active worker heartbeat was found.");
  }
} finally {
  await pool.end();
}
