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
});
