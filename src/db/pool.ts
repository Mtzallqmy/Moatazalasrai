// Shared tenant-aware node-postgres pool used by Drizzle and Graphile Worker per process.
import { Pool, type PoolClient } from "pg";
import { env } from "@/lib/config/env";
import { currentDatabaseContext } from "@/lib/security/database-context";

const RUNTIME_ROLE = "moataz_app_runtime";

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

async function configureClient(client: PoolClient) {
  const context = currentDatabaseContext();
  const testFallback = !context && process.env.NODE_ENV === "test";
  await client.query(`SET ROLE ${RUNTIME_ROLE}`);
  await client.query(
    `SELECT
      set_config('app.rls_bypass', $1, false),
      set_config('app.current_organization_id', $2, false),
      set_config('app.current_user_id', $3, false)`,
    [
      context?.mode === "system" || testFallback ? "on" : "off",
      context && "organizationId" in context ? context.organizationId : "",
      context && "userId" in context ? context.userId ?? "" : "",
    ],
  );

  const originalRelease = client.release.bind(client);
  client.release = (error?: Error | boolean) => {
    client.release = originalRelease;
    void client.query(
      `SELECT
        set_config('app.rls_bypass', '', false),
        set_config('app.current_organization_id', '', false),
        set_config('app.current_user_id', '', false)`,
    ).catch(reportPoolError).finally(() => {
      void client.query("RESET ROLE").catch(reportPoolError).finally(() => originalRelease(error));
    });
  };
  return client;
}

function installContextAwareConnect(pool: Pool) {
  const originalConnect = pool.connect.bind(pool);
  const contextualConnect = (
    callback?: (error: Error | undefined, client: PoolClient | undefined, release: ((releaseError?: Error | boolean) => void) | undefined) => void,
  ) => {
    const connection = originalConnect().then(configureClient);
    if (!callback) return connection;
    void connection.then(
      (client) => callback(undefined, client, client.release.bind(client)),
      (error: Error) => callback(error, undefined, undefined),
    );
    return undefined;
  };
  pool.connect = contextualConnect as typeof pool.connect;
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
  installContextAwareConnect(pool);
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
