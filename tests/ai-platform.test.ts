import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { retryDelayMs } from "@/ai/jobs/backoff";
import { isUnsafeToMemorize, redactMemoryInput } from "@/ai/memory/redaction";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { chunkText } from "@/ai/rag/chunk";
import { assertToolAllowed, requiresApproval } from "@/ai/tools/policy";
import { ToolRegistry } from "@/ai/tools/registry";

const dangerousTool = {
  id: "github.write", name: "GitHub write", description: "Write a file",
  inputSchema: z.object({ path: z.string() }), risk: "high" as const,
  approvalMode: "risk_based" as const, timeoutMs: 10_000,
  requiredRoles: ["owner", "developer"] as Array<"owner" | "developer">,
  execute: vi.fn(async () => ({ ok: true })),
};

describe("AI platform expansion", () => {
  it("chunks content with bounded overlap", () => {
    const chunks = chunkText("فقرة اختبار. ".repeat(200), { size: 300, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk, index) => chunk.index === index && chunk.text.length > 0)).toBe(true);
    expect(() => chunkText("x", { size: 200, overlap: 200 })).toThrow("INVALID_CHUNK_OPTIONS");
  });

  it("rejects secrets from opt-in memory", () => {
    expect(redactMemoryInput("api_key=abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED]");
    expect(isUnsafeToMemorize("token=abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isUnsafeToMemorize("يفضل المستخدم الإجابات المختصرة")).toBe(false);
  });

  it("enforces allowlist, role, and explicit approval", () => {
    const registry = new ToolRegistry();
    registry.register(dangerousTool);
    expect(requiresApproval(dangerousTool)).toBe(true);
    expect(() => assertToolAllowed(registry.get("github.write"), "viewer", true)).toThrow("TOOL_ROLE_FORBIDDEN");
    expect(() => assertToolAllowed(registry.get("github.write"), "owner", false)).toThrow("TOOL_APPROVAL_REQUIRED");
    expect(() => registry.get("shell.raw")).toThrow("TOOL_NOT_ALLOWED");
  });

  it("redacts telemetry fields without leaking content", () => {
    const safe = safeTelemetry({ requestId: "r", operation: "run", token: "secret", prompt: "private", durationMs: 2 });
    expect(safe).toEqual({ requestId: "r", operation: "run", durationMs: 2 });
  });

  it("bounds retry backoff", () => {
    for (let attempt = 1; attempt < 20; attempt += 1) {
      expect(retryDelayMs(attempt)).toBeLessThanOrEqual(72_000);
    }
  });
});
