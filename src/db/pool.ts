// PostgreSQL pools are separated by runtime trust plane. Tenant/platform/worker pools
// always assume a non-owner database role before a caller receives a client.
import { Pool, type PoolClient } from "pg";
import { currentDatabaseAccessContext } from "@/db/tenant-context";
import { env } from "@/lib/config/env";

export type DatabaseProcessKind = "web" | "worker";
type RuntimeDatabaseRole = "moataz_app" | "moataz_platform" | "moataz_worker";
type Release = (release?: Error | boolean) => void;
type ConnectCallback = (err: Error | undefined, client: PoolClient | undefined, done: Release) => void;

const globalForPostgres = globalThis as typeof globalThis & {
  __moatazPostgresSystemPool?: Pool;
  __moatazPostgresTenantPool?: RolePool;
  __moatazPostgresPlatformPool?: RolePool;
  __moatazPostgresWorkerPool?: RolePool;
  __moatazDatabaseProcessKind?: DatabaseProcessKind;
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

function poolBudget() {
  const parsed = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10);
  return Number.isSafeInteger(parsed) ? Math.min(40, Math.max(6, parsed)) : 10;
}

function processKind(): DatabaseProcessKind {
  return globalForPostgres.__moatazDatabaseProcessKind ?? "web";
}

function poolLimit(kind: "system" | "tenant" | "platform" | "worker") {
  const budget = poolBudget();
  if (processKind() === "worker") {
    const system = Math.max(3, Math.ceil(budget / 2));
    return kind === "system" ? system : Math.max(3, budget - system);
  }
  if (kind === "system" || kind === "platform") return 2;
  return Math.max(2, budget - 4);
}

function poolConfig(max: number) {
  return {
    connectionString: env().databaseUrl,
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 20_000,
    allowExitOnIdle: false,
  };
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error("DATABASE_ROLE_INITIALIZATION_FAILED");
}

class RolePool extends Pool {
  constructor(private readonly databaseRole: RuntimeDatabaseRole, private readonly contextKind: "tenant" | "platform" | "worker", max: number) {
    super(poolConfig(max));
    this.on("error", reportPoolError);
    this.on("connect", attachClientErrorHandler);
  }

  private async prepare(client: PoolClient) {
    const context = currentDatabaseAccessContext();
    if (this.contextKind === "tenant") {
      if (context?.kind !== "tenant") throw new Error("DATABASE_TENANT_CONTEXT_REQUIRED");
      await client.query(`SET ROLE ${this.databaseRole}`);
      await client.query(
        "SELECT set_config('app.organization_id', $1, false), set_config('app.user_id', $2, false)",
        [context.organizationId, context.userId ?? ""],
      );
      return;
    }
    if (this.contextKind === "platform") {
      if (context?.kind !== "platform") throw new Error("DATABASE_PLATFORM_CONTEXT_REQUIRED");
      await client.query(`SET ROLE ${this.databaseRole}`);
      await client.query(
        "SELECT set_config('app.organization_id', '', false), set_config('app.user_id', $1, false)",
        [context.userId],
      );
      return;
    }
    await client.query(`SET ROLE ${this.databaseRole}`);
    await client.query("SELECT set_config('app.organization_id', '', false), set_config('app.user_id', '', false)");
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    if (callback) {
      super.connect((error, client, done) => {
        if (error || !client) {
          callback(error ?? new Error("DATABASE_CONNECTION_FAILED"), client, done);
          return;
        }
        void this.prepare(client).then(() => callback(undefined, client, done)).catch((prepareError) => {
          done(true);
          callback(asError(prepareError), client, done);
        });
      });
      return;
    }
    return super.connect().then(async (client) => {
      try {
        await this.prepare(client);
        return client;
      } catch (error) {
        client.release(true);
        throw asError(error);
      }
    });
  }
}

function createSystemPool() {
  const pool = new Pool(poolConfig(poolLimit("system")));
  pool.on("error", reportPoolError);
  pool.on("connect", attachClientErrorHandler);
  return pool;
}

export function configureDatabaseProcessKind(kind: DatabaseProcessKind) {
  const existing = globalForPostgres.__moatazDatabaseProcessKind;
  if (existing && existing !== kind) throw new Error("DATABASE_PROCESS_KIND_ALREADY_CONFIGURED");
  if (
    globalForPostgres.__moatazPostgresSystemPool
    || globalForPostgres.__moatazPostgresTenantPool
    || globalForPostgres.__moatazPostgresPlatformPool
    || globalForPostgres.__moatazPostgresWorkerPool
  ) {
    if (processKind() !== kind) throw new Error("DATABASE_POOL_ALREADY_INITIALIZED");
  }
  globalForPostgres.__moatazDatabaseProcessKind = kind;
}

export function getSystemPostgresPool() {
  globalForPostgres.__moatazPostgresSystemPool ??= createSystemPool();
  return globalForPostgres.__moatazPostgresSystemPool;
}

function tenantPool() {
  globalForPostgres.__moatazPostgresTenantPool ??= new RolePool("moataz_app", "tenant", poolLimit("tenant"));
  return globalForPostgres.__moatazPostgresTenantPool;
}

function platformPool() {
  globalForPostgres.__moatazPostgresPlatformPool ??= new RolePool("moataz_platform", "platform", poolLimit("platform"));
  return globalForPostgres.__moatazPostgresPlatformPool;
}

function workerPool() {
  globalForPostgres.__moatazPostgresWorkerPool ??= new RolePool("moataz_worker", "worker", poolLimit("worker"));
  return globalForPostgres.__moatazPostgresWorkerPool;
}

export function getPostgresPool(): Pool {
  if (processKind() === "worker") return workerPool();
  const context = currentDatabaseAccessContext();
  if (context?.kind === "tenant") return tenantPool();
  if (context?.kind === "platform") return platformPool();
  return getSystemPostgresPool();
}

export function postgresPoolSnapshot() {
  const entries = [
    ["system", globalForPostgres.__moatazPostgresSystemPool],
    ["tenant", globalForPostgres.__moatazPostgresTenantPool],
    ["platform", globalForPostgres.__moatazPostgresPlatformPool],
    ["worker", globalForPostgres.__moatazPostgresWorkerPool],
  ] as const;
  return entries.flatMap(([name, pool]) => pool ? [{
    name,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: pool.options.max,
  }] : []);
}

export async function closePostgresPool() {
  const pools = [
    globalForPostgres.__moatazPostgresSystemPool,
    globalForPostgres.__moatazPostgresTenantPool,
    globalForPostgres.__moatazPostgresPlatformPool,
    globalForPostgres.__moatazPostgresWorkerPool,
  ].filter((pool): pool is Pool => Boolean(pool));
  delete globalForPostgres.__moatazPostgresSystemPool;
  delete globalForPostgres.__moatazPostgresTenantPool;
  delete globalForPostgres.__moatazPostgresPlatformPool;
  delete globalForPostgres.__moatazPostgresWorkerPool;
  await Promise.all(pools.map((pool) => pool.end()));
}
