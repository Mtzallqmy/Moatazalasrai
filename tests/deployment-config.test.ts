import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type RailwayConfig = {
  build?: {
    builder?: string;
    dockerfilePath?: string;
  };
  deploy?: {
    preDeployCommand?: string;
    startCommand?: string;
    healthcheckPath?: string;
    healthcheckTimeout?: number;
  };
};

async function railwayConfig(path = "railway.json"): Promise<RailwayConfig> {
  return JSON.parse(await readFile(path, "utf8")) as RailwayConfig;
}

describe("Railway deployment configuration", () => {
  it("runs platform and Graphile migrations once before the web release", async () => {
    const config = await railwayConfig();
    expect(config.deploy?.preDeployCommand).toBe("npm run db:migrate:all && npm run bootstrap:owner");
    expect(config.deploy?.startCommand).toBe("npm run start");
  });

  it("runs a dedicated Worker service without repeating pre-deploy migrations", async () => {
    const worker = await railwayConfig("railway.worker.json");
    expect(worker.deploy?.startCommand).toBe("npm run worker");
    expect(worker.deploy?.preDeployCommand).toBeUndefined();
  });

  it("gates web traffic on database-backed readiness", async () => {
    const config = await railwayConfig();
    expect(config.deploy?.healthcheckPath).toBe("/api/ready");
    expect(config.deploy?.healthcheckTimeout).toBeGreaterThanOrEqual(120);
  });

  it("uses node-postgres with explicit runtime trust planes and a dedicated Graphile pool", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const [databaseSource, poolSource, workerSource, queueSource, migrationSource, workerMigrationSource] = await Promise.all([
      readFile("src/db/index.ts", "utf8"),
      readFile("src/db/pool.ts", "utf8"),
      readFile("src/worker/index.ts", "utf8"),
      readFile("src/worker/queue.ts", "utf8"),
      readFile("scripts/migrate.mjs", "utf8"),
      readFile("scripts/migrate-worker.mjs", "utf8"),
    ]);

    expect(packageJson.dependencies?.pg).toBeTruthy();
    expect(packageJson.dependencies?.postgres).toBeUndefined();
    expect(packageJson.dependencies?.["graphile-worker"]).toBeTruthy();
    expect(databaseSource).toContain('from "drizzle-orm/node-postgres"');
    expect(poolSource).toContain('from "pg"');
    expect(poolSource).toContain('new RolePool("moataz_app", "tenant"');
    expect(poolSource).toContain('new RolePool("moataz_platform", "platform"');
    expect(poolSource).toContain('new RolePool("moataz_worker", "worker"');
    expect(workerSource).toContain("configureDatabaseProcessKind(\"worker\")");
    expect(workerSource).toContain("pgPool: getSystemPostgresPool()");
    expect(queueSource).toContain("app_security.enqueue_job");
    expect(queueSource).not.toContain("makeWorkerUtils({ pgPool: getPostgresPool() })");
    expect(workerMigrationSource).toContain("SECURITY DEFINER");
    expect(workerMigrationSource).toContain("app_security.enqueue_job");
    expect(migrationSource).toContain('import pg from "pg"');
  });

  it("creates and records the required schema in an explicit transaction", async () => {
    const migrationSource = await readFile("scripts/migrate.mjs", "utf8");
    const workerMigrationSource = await readFile("scripts/migrate-worker.mjs", "utf8");

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS "_platform_migrations"');
    expect(migrationSource).toContain('INSERT INTO "_platform_migrations"');
    expect(migrationSource).toContain('client.query("BEGIN")');
    expect(migrationSource).toContain('client.query("COMMIT")');
    expect(migrationSource).toContain('client.query("ROLLBACK")');
    expect(workerMigrationSource).toContain("runMigrations");
    expect(workerMigrationSource).toContain("pgPool: pool");
  });

  it("pins the same Node runtime across local, package, CI, and Docker", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { engines?: { node?: string } };
    const [nvmrc, docker, ci] = await Promise.all([
      readFile(".nvmrc", "utf8"),
      readFile("Dockerfile", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8"),
    ]);
    expect(packageJson.engines?.node).toBe("22.18.0");
    expect(nvmrc.trim()).toBe("22.18.0");
    expect(docker).toContain("ARG NODE_VERSION=22.18.0");
    expect(ci).toContain("node-version-file: .nvmrc");
  });

  it("pins actions and refuses an unsigned production Android release", async () => {
    const workflows = await Promise.all([
      "ci.yml", "android-ci.yml", "android-release.yml",
    ].map((name) => readFile(`.github/workflows/${name}`, "utf8")));
    expect(workflows.join("\n")).not.toMatch(/uses:\s+[^\s]+@v\d/);
    const release = workflows[2];
    const gradle = await readFile("apps/mobile/android/app/build.gradle.kts", "utf8");
    expect(release).toContain("Validate release prerequisites");
    expect(release).toContain("Production release signing secrets are required");
    expect(release).toContain('--retry 4 --retry-delay 5 --retry-all-errors');
    expect(release).toMatch(/push:\s+tags:\s+- "android-v\*"/);
    expect(release).not.toMatch(/push:\s+branches:\s+- main/);
    expect(gradle).toContain("ALLOW_DEBUG_RELEASE_SIGNING");
    expect(gradle).toContain("Release keystore is required");
  });

  it("does not retain the obsolete self-modifying contract workflow", async () => {
    await expect(access(".github/workflows/sync-mobile-openapi.yml")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rotates the web session at the organization trust boundary", async () => {
    const session = await readFile("src/lib/auth/session.ts", "utf8");
    expect(session).toContain("tokenHash: hashToken(nextToken)");
    expect(session).toContain("SESSION_IDLE_DAYS = 7");
  });
});
