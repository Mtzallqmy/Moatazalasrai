// Shared node-postgres pool used by Drizzle, Graphile Worker, and queue utilities per process.
import { Pool, type PoolClient } from "pg";
import { env } from "@/lib/config/env";

const globalForPostgres = globalThis as typeof globalThis & {
  __moatazPostgresPool?: Pool;
};

function reportPoolError(error: Error) {
  console.error(JSON.stringify({
    level: "error",
    event: "postgres.pool.error",
    errorName: error.name,
  }));
}

function attachClientErrorHandler(client: PoolClient) {
  client.on("error", reportPoolError);
}

function createPostgresPool() {
  const pool = new Pool({
    connectionString: env().databaseUrl,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 20_000,
    allowExitOnIdle: false,
  });
  pool.on("error", reportPoolError);
  pool.on("connect", attachClientErrorHandler);
  return pool;
}

export function getPostgresPool() {
  globalForPostgres.__moatazPostgresPool ??= createPostgresPool();
  return globalForPostgres.__moatazPostgresPool;
}

export async function closePostgresPool() {
  const pool = globalForPostgres.__moatazPostgresPool;
  if (!pool) return;
  delete globalForPostgres.__moatazPostgresPool;
  await pool.end();
}
