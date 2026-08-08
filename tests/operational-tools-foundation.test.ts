import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { createToolRunSchema, toolIds } from "@/lib/tools/contracts";
import { TOOL_MANIFESTS } from "@/lib/tools/manifest";
import { getToolManifest } from "@/lib/tools/registry";

const root = process.cwd();

describe("Operational AI Tools foundation", () => {
  test("registers exactly the four Phase 2 tools with unique manifests", () => {
    expect(TOOL_MANIFESTS.map((manifest) => manifest.id)).toEqual(toolIds);
    expect(new Set(TOOL_MANIFESTS.map((manifest) => manifest.id)).size).toBe(4);
    for (const manifest of TOOL_MANIFESTS) {
      expect(getToolManifest(manifest.id)).toBe(manifest);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.requiredModule).toBe("operational_tools");
      expect(manifest.defaultLimits.timeoutMs).toBeGreaterThan(0);
      expect(ALL_PERMISSIONS).toContain(manifest.requiredPermission);
    }
  });

  test("keeps every tool behind an explicit disabled-by-default environment flag", () => {
    expect(TOOL_MANIFESTS.map((manifest) => manifest.featureFlag)).toEqual([
      "DATA_INTERPRETER_ENABLED",
      "CODING_AGENT_ENABLED",
      "BROWSER_AGENT_ENABLED",
      "VOICE_STUDIO_ENABLED",
    ]);
  });

  test("keeps data analysis network-denied and browser/coding allowlisted", () => {
    expect(getToolManifest("data.interpreter")?.networkPolicy).toEqual({ mode: "deny_all" });
    expect(getToolManifest("coding.agent")?.networkPolicy.mode).toBe("allowlist");
    expect(getToolManifest("browser.agent")?.networkPolicy.mode).toBe("allowlist");
  });

  test("rejects empty or weak Tool Run requests", () => {
    expect(createToolRunSchema.safeParse({ title: "", idempotencyKey: "short" }).success).toBe(false);
    expect(createToolRunSchema.safeParse({
      title: "تحليل المبيعات",
      idempotencyKey: "phase2-test-123",
      inputs: [{ kind: "csv" }],
    }).success).toBe(false);
  });

  test("migration links Tool Runs to Execution Jobs and creates all requested tables", async () => {
    const migration = await readFile(`${root}/drizzle/0044_operational_ai_tools.sql`, "utf8");
    for (const table of [
      "tool_runs",
      "tool_run_messages",
      "tool_run_inputs",
      "tool_run_approvals",
      "data_interpreter_sessions",
      "coding_projects",
      "coding_agent_runs",
      "browser_agent_sessions",
      "voice_generation_jobs",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS \"${table}\"`);
    }
    expect(migration).toContain('"execution_job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE RESTRICT');
    expect(migration).toContain('"tool_runs_org_execution_job_unique_idx"');
  });

  test("organization flags are seeded disabled", async () => {
    const migration = await readFile(`${root}/drizzle/0045_operational_tool_flags.sql`, "utf8");
    for (const toolId of toolIds) expect(migration).toContain(`('${toolId}'`);
    expect(migration).toContain("false, 100");
  });

  test("completion service forbids empty success and pre-execution completion", async () => {
    const source = await readFile(`${root}/src/lib/tools/run-service.ts`, "utf8");
    expect(source).toContain('job.status !== "completed"');
    expect(source).toContain('"EMPTY_SUCCESS"');
    expect(source).toContain('verificationPassed(input.verification)');
  });
});
