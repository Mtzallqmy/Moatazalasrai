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
});
