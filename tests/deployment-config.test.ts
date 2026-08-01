import { readFile } from "node:fs/promises";
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
    expect(config.deploy?.preDeployCommand).toBe("npm run db:migrate:all");
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

  it("uses a Railway-compatible PostgreSQL TCP driver", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const databaseSource = await readFile("src/db/index.ts", "utf8");
    const migrationSource = await readFile("scripts/migrate.mjs", "utf8");

    expect(packageJson.dependencies?.postgres).toBeTruthy();
    expect(packageJson.dependencies?.["graphile-worker"]).toBeTruthy();
    expect(databaseSource).toContain('from "drizzle-orm/postgres-js"');
    expect(migrationSource).toContain('from "postgres"');
  });

  it("creates and records the required schema before every Railway release", async () => {
    const migrationSource = await readFile("scripts/migrate.mjs", "utf8");
    const workerMigrationSource = await readFile("scripts/migrate-worker.mjs", "utf8");

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS "_platform_migrations"');
    expect(migrationSource).toContain('INSERT INTO "_platform_migrations"');
    expect(migrationSource).toContain("sql.begin");
    expect(workerMigrationSource).toContain("runMigrations");
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
    expect(ci).toContain("node-version: 22.18.0");
  });

  it("pins actions and refuses an unsigned production Android release", async () => {
    const workflows = await Promise.all([
      "ci.yml", "android-ci.yml", "android-release.yml", "sync-mobile-openapi.yml",
    ].map((name) => readFile(`.github/workflows/${name}`, "utf8")));
    expect(workflows.join("\n")).not.toMatch(/uses:\s+[^\s]+@v\d/);
    const release = workflows[2];
    const gradle = await readFile("apps/mobile/android/app/build.gradle.kts", "utf8");
    expect(release).toContain("Production release signing secrets are required");
    expect(gradle).toContain("ALLOW_DEBUG_RELEASE_SIGNING");
    expect(gradle).toContain("Release keystore is required");
  });

  it("rotates the web session at the organization trust boundary", async () => {
    const session = await readFile("src/lib/auth/session.ts", "utf8");
    expect(session).toContain("tokenHash: hashToken(nextToken)");
    expect(session).toContain("SESSION_IDLE_DAYS = 7");
  });
});
