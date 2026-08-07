import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executionLimitsSchema, networkPolicySchema } from "@/lib/execution/contracts";
import { sanitizeExecutionEventPayload, safeOutputChunk } from "@/lib/execution/event-service";
import { isPublicAddress, normalizeNetworkPolicy } from "@/lib/execution/network-policy-service";
import { mergeExecutionLimits } from "@/lib/execution/quota-service";
import { MockExecutionRunner } from "@/lib/execution/runners/mock-runner";
import { canTransitionExecutionStatus } from "@/lib/execution/states";
import {
  diagnosticCommand,
  normalizeWorkspacePath,
  sanitizeCommandEnvironment,
  validateCommandRequest,
} from "@/lib/execution/validation";

const limits = executionLimitsSchema.parse({
  timeoutMs: 300_000,
  cpuMillis: 300_000,
  memoryBytes: 536_870_912,
  diskBytes: 1_073_741_824,
  maxProcesses: 64,
  maxOutputBytes: 5_242_880,
  maxArtifactBytes: 104_857_600,
  maxNetworkBytes: 0,
  maxFiles: 5_000,
  maxSingleFileBytes: 26_214_400,
});

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.EXECUTION_DEFAULT_TIMEOUT_MS = "300000";
  process.env.EXECUTION_DEFAULT_MEMORY_BYTES = "536870912";
  process.env.EXECUTION_DEFAULT_DISK_BYTES = "1073741824";
  process.env.EXECUTION_DEFAULT_MAX_PROCESSES = "64";
  process.env.EXECUTION_DEFAULT_MAX_OUTPUT_BYTES = "5242880";
  process.env.EXECUTION_DEFAULT_MAX_ARTIFACT_BYTES = "104857600";
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("execution state machine", () => {
  it("allows the expected durable lifecycle", () => {
    expect(canTransitionExecutionStatus("queued", "provisioning")).toBe(true);
    expect(canTransitionExecutionStatus("provisioning", "ready")).toBe(true);
    expect(canTransitionExecutionStatus("ready", "running")).toBe(true);
    expect(canTransitionExecutionStatus("running", "completed")).toBe(true);
  });

  it("rejects returning from terminal states and illegal shortcuts", () => {
    expect(canTransitionExecutionStatus("completed", "running")).toBe(false);
    expect(canTransitionExecutionStatus("queued", "completed")).toBe(false);
    expect(canTransitionExecutionStatus("failed", "queued")).toBe(false);
  });
});

describe("execution limits", () => {
  it("applies the most restrictive value from every layer", () => {
    const merged = mergeExecutionLimits(
      { timeoutMs: 120_000, memoryBytes: 268_435_456 },
      { timeoutMs: 60_000, maxOutputBytes: 1_048_576 },
    );
    expect(merged.timeoutMs).toBe(60_000);
    expect(merged.memoryBytes).toBe(268_435_456);
    expect(merged.maxOutputBytes).toBe(1_048_576);
    expect(merged.diskBytes).toBe(1_073_741_824);
  });
});

describe("command and path validation", () => {
  it("creates only the fixed diagnostic argv contract", () => {
    const command = diagnosticCommand("success", limits);
    expect(command.argv[0]).toBe("python3");
    expect(command.argv[1]).toBe("-c");
    expect(command.argv).toHaveLength(3);
    expect(command.cwd).toBe(".");
  });

  it("rejects free shell commands and path traversal", () => {
    expect(() => validateCommandRequest({
      argv: ["bash", "-c", "cat /etc/passwd"],
      cwd: ".",
      timeoutMs: 10_000,
    })).toThrow(/التشخيص الثابت/);
    expect(() => normalizeWorkspacePath("../../etc/passwd")).toThrow(/الخروج من مساحة التنفيذ/);
    expect(() => normalizeWorkspacePath("safe\\..\\secret")).toThrow(/غير صالح/);
  });

  it("rejects sensitive environment variables", () => {
    expect(() => sanitizeCommandEnvironment({ DATABASE_URL: "postgres://secret" })).toThrow(/غير مسموح/);
    expect(() => sanitizeCommandEnvironment({ OPENAI_API_KEY: "secret" })).toThrow(/غير مسموح/);
    expect(sanitizeCommandEnvironment({ LANG: "C.UTF-8", NO_COLOR: "1" })).toEqual({ LANG: "C.UTF-8", NO_COLOR: "1" });
  });
});

describe("network policy", () => {
  it("remains deny-all unless a complete allowlist is supplied", () => {
    expect(normalizeNetworkPolicy().mode).toBe("deny_all");
    expect(() => normalizeNetworkPolicy({ mode: "allowlist", allowedHosts: ["example.com"] })).toThrow(/منافذ/);
    expect(networkPolicySchema.parse({
      mode: "allowlist",
      allowedHosts: ["example.com"],
      allowedPorts: [443],
      allowDns: true,
      allowedMethods: ["GET"],
      maxRequests: 1,
    }).mode).toBe("allowlist");
  });

  it("blocks local private link-local and metadata addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.2", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "fe80::1"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});

describe("safe append-only event payloads", () => {
  it("removes keys that could expose credentials or content", () => {
    const payload = sanitizeExecutionEventPayload({
      status: "running",
      authorization: "Bearer secret",
      apiKey: "secret",
      nested: { token: "secret", exitCode: 0 },
    });
    expect(payload).toEqual({ status: "running", nested: { exitCode: 0 } });
  });

  it("truncates output chunks before persistence", () => {
    const chunk = new TextEncoder().encode("x".repeat(100));
    const safe = safeOutputChunk(chunk, 10);
    expect(safe.bytes).toBe(10);
    expect(safe.originalBytes).toBe(100);
    expect(safe.truncated).toBe(true);
  });
});

describe("mock runner contract", () => {
  it("creates a workspace executes argv streams stdout and downloads the artifact", async () => {
    const runner = new MockExecutionRunner(limits);
    const workspace = await runner.createWorkspace({
      executionId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      templateId: "moataz-code",
      limits,
      networkPolicy: normalizeNetworkPolicy(),
    });
    const stdout: string[] = [];
    const result = await runner.executeCommand(workspace.externalWorkspaceId, diagnosticCommand("success", limits), {
      onStdout: async (chunk) => { stdout.push(new TextDecoder().decode(chunk)); },
      onStderr: async () => undefined,
      onState: async () => undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(stdout.join("").trim()).toBe("4");
    const files = await runner.listFiles(workspace.externalWorkspaceId, ".");
    expect(files).toContainEqual({ path: "result.txt", sizeBytes: 2, type: "file" });
    const chunks: Uint8Array[] = [];
    for await (const chunk of await runner.downloadFile(workspace.externalWorkspaceId, "result.txt")) chunks.push(chunk);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("4\n");
    await runner.destroyWorkspace(workspace.externalWorkspaceId);
  });

  it("reports non-zero exit and timeout without claiming completion", async () => {
    const runner = new MockExecutionRunner(limits);
    const failureWorkspace = await runner.createWorkspace({ executionId: "failure", organizationId: "org", templateId: "moataz-code", limits, networkPolicy: normalizeNetworkPolicy() });
    const failure = await runner.executeCommand(failureWorkspace.externalWorkspaceId, diagnosticCommand("failure", limits), {
      onStdout: async () => undefined,
      onStderr: async () => undefined,
      onState: async () => undefined,
    });
    expect(failure.exitCode).toBe(7);
    expect(failure.timedOut).toBe(false);

    const timeoutWorkspace = await runner.createWorkspace({ executionId: "timeout", organizationId: "org", templateId: "moataz-code", limits, networkPolicy: normalizeNetworkPolicy() });
    const timeout = await runner.executeCommand(timeoutWorkspace.externalWorkspaceId, diagnosticCommand("timeout", limits), {
      onStdout: async () => undefined,
      onStderr: async () => undefined,
      onState: async () => undefined,
    });
    expect(timeout.timedOut).toBe(true);
    expect(timeout.exitCode).toBeNull();
  });
});
