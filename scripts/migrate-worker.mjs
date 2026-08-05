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
  console.log(JSON.stringify({ level: "info", event: "graphile.migrations.completed" }));
} finally {
  await pool.end();
}
