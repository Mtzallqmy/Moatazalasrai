import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import {
  browserAgentRunSchema,
  codingAgentRunSchema,
  dataInterpreterRunSchema,
  voiceStudioRunSchema,
} from "@/lib/tools/runtime-contracts";

const root = process.cwd();

describe("Operational AI Tools runtime", () => {
  test("accepts bounded Data Interpreter requests and rejects empty objectives", () => {
    expect(dataInterpreterRunSchema.safeParse({ title: "Data", idempotencyKey: "data-run-001", objective: "profile", dataset: [{ amount: 10 }] }).success).toBe(true);
    expect(dataInterpreterRunSchema.safeParse({ title: "Data", idempotencyKey: "data-run-002", objective: "", dataset: [] }).success).toBe(false);
  });

  test("coding operations reject traversal paths", () => {
    expect(codingAgentRunSchema.safeParse({ title: "Code", idempotencyKey: "code-run-001", objective: "update", files: { "src/a.ts": "a" }, operations: [{ kind: "write", path: "../secret", content: "x" }] }).success).toBe(false);
  });

  test("browser plans require start host in allowlist and keep writes fail-closed", () => {
    const readPlan = { connectionId: "00000000-0000-4000-8000-000000000001", objective: "read", steps: [{ id: "s1", action: "navigate", url: "https://example.com", requiredPermission: "navigate", risk: "low", expectedResult: "loaded" }] };
    expect(browserAgentRunSchema.safeParse({ title: "Browser", idempotencyKey: "browser-001", startUrl: "https://example.com", allowedDomains: ["example.com"], plan: readPlan }).success).toBe(true);
    expect(browserAgentRunSchema.safeParse({ title: "Browser", idempotencyKey: "browser-002", startUrl: "https://evil.example", allowedDomains: ["example.com"], plan: readPlan }).success).toBe(false);
    const writePlan = { connectionId: "00000000-0000-4000-8000-000000000001", objective: "submit", steps: [{ id: "s1", action: "submit", target: { testId: "save" }, requiredPermission: "update", risk: "medium", expectedResult: "saved" }] };
    expect(browserAgentRunSchema.safeParse({ title: "Browser", idempotencyKey: "browser-003", startUrl: "https://example.com", allowedDomains: ["example.com"], plan: writePlan }).success).toBe(false);
  });

  test("voice requests are provider explicit", () => {
    expect(voiceStudioRunSchema.safeParse({ title: "Voice", idempotencyKey: "voice-run-001", provider: "openai", voiceId: "alloy", text: "hello", format: "mp3" }).success).toBe(true);
  });

  test("worker uses isolated runner instead of local child processes", async () => {
    const runtime = await readFile(`${root}/src/lib/tools/operational-tool-runtime.ts`, "utf8");
    const tasks = await readFile(`${root}/src/worker/task-list.ts`, "utf8");
    expect(runtime).not.toContain("child_process");
    expect(runtime).not.toContain("spawn(");
    expect(runtime).toContain("requireHealthyExecutionRunner");
    expect(runtime).toContain("startBrowserRunnerTask");
    expect(runtime).toContain("/v1/audio/speech");
    expect(runtime).toContain("/v1/text-to-speech/");
    expect(tasks).toContain('"operational-tool-execute"');
  });

  test("runtime requires non-empty evidence before success", async () => {
    const runtime = await readFile(`${root}/src/lib/tools/operational-tool-runtime.ts`, "utf8");
    expect(runtime).toContain('output.artifactCount < 1');
    expect(runtime).toContain('verification: { passed: true');
  });
});
