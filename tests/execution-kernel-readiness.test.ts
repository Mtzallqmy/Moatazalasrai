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
  it("fails closed while the shared Execution Kernel is incomplete", () => {
    const result = spawnSync(process.execPath, ["scripts/check-execution-kernel-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    const payload = JSON.parse(result.stdout) as ReadinessResult;
    expect(payload.ready).toBe(false);
    expect(payload.scannedRoots).toEqual(["src", "services", "drizzle"]);
    expect(payload.scannedFiles).toBeGreaterThan(0);

    const missing = new Set(payload.missing.map((item) => item.id));
    expect(missing.has("db.execution_jobs")).toBe(true);
    expect(missing.has("db.execution_workspaces")).toBe(true);
    expect(missing.has("db.execution_steps")).toBe(true);
    expect(missing.has("db.execution_events")).toBe(true);
    expect(missing.has("db.execution_artifacts")).toBe(true);
    expect(missing.has("db.execution_usage")).toBe(true);
    expect(missing.has("contract.ExecutionRunner")).toBe(true);
    expect(missing.has("adapter.ExistingSandboxAdapter")).toBe(true);
    expect(missing.has("worker.execution_tasks")).toBe(true);
    expect(missing.has("credentials.broker")).toBe(true);
  });
});
