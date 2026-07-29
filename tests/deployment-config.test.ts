import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type RailwayConfig = {
  build?: {
    builder?: string;
    dockerfilePath?: string;
  };
  deploy?: {
    preDeployCommand?: string;
    healthcheckPath?: string;
    healthcheckTimeout?: number;
  };
};

async function railwayConfig(): Promise<RailwayConfig> {
  return JSON.parse(await readFile("railway.json", "utf8")) as RailwayConfig;
}

describe("Railway deployment configuration", () => {
  it("runs database migrations before starting a new release", async () => {
    const config = await railwayConfig();
    expect(config.deploy?.preDeployCommand).toBe("npm run db:migrate");
  });

  it("gates traffic on database-backed readiness", async () => {
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
    expect(databaseSource).toContain('from "drizzle-orm/postgres-js"');
    expect(migrationSource).toContain('from "postgres"');
  });

  it("creates and records the required schema before every Railway release", async () => {
    const migrationSource = await readFile("scripts/migrate.mjs", "utf8");

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS "_platform_migrations"');
    expect(migrationSource).toContain('INSERT INTO "_platform_migrations"');
    expect(migrationSource).toContain("sql.begin");
  });
});
