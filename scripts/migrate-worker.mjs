import { runMigrations } from "graphile-worker";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required to migrate Graphile Worker.");

function reportPoolError(event, error) {
  process.stderr.write(`${JSON.stringify({ level: "error", event, errorName: error.name })}\n`);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
pool.on("error", (error) => reportPoolError("graphile.migration.pool_error", error));
pool.on("connect", (client) => {
  client.on("error", (error) => reportPoolError("graphile.migration.client_error", error));
});

try {
  await runMigrations({ pgPool: pool });
  const hardening = await pool.query(`
    SELECT
      to_regrole('moataz_app') IS NOT NULL
      AND to_regrole('moataz_platform') IS NOT NULL
      AND to_regrole('moataz_worker') IS NOT NULL
      AND to_regnamespace('app_security') IS NOT NULL AS enabled
  `);
  if (hardening.rows[0]?.enabled) {
    await pool.query(`GRANT USAGE ON SCHEMA graphile_worker TO moataz_app, moataz_platform, moataz_worker`);
    await pool.query(`
      DO $$
      DECLARE target record;
      BEGIN
        FOR target IN
          SELECT p.oid::regprocedure AS signature
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'graphile_worker' AND p.proname = 'add_job'
        LOOP
          EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', target.signature);
          EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, graphile_worker', target.signature);
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', target.signature);
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO moataz_app, moataz_platform, moataz_worker', target.signature);
        END LOOP;
      END $$
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION app_security.enqueue_job(
        identifier text,
        payload json,
        queue_name text,
        run_at timestamptz,
        max_attempts integer,
        job_key text,
        priority integer,
        job_key_mode text DEFAULT 'unsafe_dedupe'
      ) RETURNS bigint
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = pg_catalog, graphile_worker
      AS $$
        SELECT id::bigint
        FROM graphile_worker.add_job(
          identifier => identifier,
          payload => payload,
          queue_name => queue_name,
          run_at => run_at,
          max_attempts => max_attempts,
          job_key => job_key,
          priority => priority,
          job_key_mode => job_key_mode
        )
      $$
    `);
    await pool.query(`REVOKE ALL ON FUNCTION app_security.enqueue_job(text, json, text, timestamptz, integer, text, integer, text) FROM PUBLIC`);
    await pool.query(`GRANT EXECUTE ON FUNCTION app_security.enqueue_job(text, json, text, timestamptz, integer, text, integer, text) TO moataz_app, moataz_platform, moataz_worker`);
    console.log(JSON.stringify({ level: "info", event: "graphile.enqueue_boundary.completed" }));
  }
  console.log(JSON.stringify({ level: "info", event: "graphile.migrations.completed" }));
} finally {
  await pool.end();
}
