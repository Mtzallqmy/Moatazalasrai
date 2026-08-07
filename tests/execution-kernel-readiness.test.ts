import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type ReadinessResult = {
  ready: boolean;
  scannedRoots: string[];
  scannedFiles: number;
  checks: Array<{ id: string; ok: boolean; expected: string }>;
  missing: Array<{ id: string; expected: string }>;
};

describe("Phase 2 Execution Kernel readiness", () => {
  it("passes only when every mandatory shared-kernel capability is present", () => {
    const result = spawnSync(process.execPath, ["scripts/check-execution-kernel-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as ReadinessResult;
    expect(payload.ready).toBe(true);
    expect(payload.scannedRoots).toEqual(["src", "services", "drizzle"]);
    expect(payload.scannedFiles).toBeGreaterThan(0);
    expect(payload.missing).toEqual([]);
    expect(payload.checks.length).toBeGreaterThanOrEqual(16);
    expect(payload.checks.every((check) => check.ok)).toBe(true);
  });
});
