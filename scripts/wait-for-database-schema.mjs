// Compose startup gate: waits for platform and Graphile tables before starting the worker.
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required while waiting for migrations.");

const timeoutMs = Number.parseInt(process.env.SCHEMA_WAIT_TIMEOUT_MS ?? "120000", 10);
const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 120_000);
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3_000 });
let ready = false;

try {
  while (Date.now() < deadline) {
    try {
      const result = await pool.query(`
        SELECT
          to_regclass('public.worker_heartbeats') IS NOT NULL
          AND to_regclass('graphile_worker.jobs') IS NOT NULL AS ready
      `);
      ready = result.rows[0]?.ready === true;
      if (ready) break;
    } catch {
      // PostgreSQL can be healthy before the web service has completed migrations.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  if (!ready) {
    throw new Error("Timed out waiting for platform and Graphile Worker migrations.");
  }
} finally {
  await pool.end();
}
