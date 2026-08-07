import type {
  CommandRequest,
  CommandResult,
  ExecutionLimits,
  ExecutionRunner,
  NetworkPolicy,
  RunnerHealth,
} from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";
import { normalizeWorkspacePath, validateCommandRequest } from "@/lib/execution/validation";

const encoder = new TextEncoder();
const mockWorkspaces = new Map<string, Map<string, Uint8Array>>();
const cancelledWorkspaces = new Set<string>();

export function resetMockExecutionRunner() {
  mockWorkspaces.clear();
  cancelledWorkspaces.clear();
}

export class MockExecutionRunner implements ExecutionRunner {
  readonly kind = "existing" as const;

  constructor(private readonly limits: ExecutionLimits) {
    if (process.env.NODE_ENV === "production") {
      throw new ExecutionError("EXECUTION_RUNNER_UNAVAILABLE", "MockRunner ممنوع في الإنتاج.");
    }
  }

  async healthCheck(): Promise<RunnerHealth> {
    return {
      ok: true,
      kind: this.kind,
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      capabilities: {
        command: true,
        files: true,
        cancellation: true,
        networkIsolation: true,
        snapshots: false,
        pauseResume: false,
      },
    };
  }

  async createWorkspace(input: {
    executionId: string;
    organizationId: string;
    templateId: string;
    limits: ExecutionLimits;
    networkPolicy: NetworkPolicy;
  }) {
    if (input.networkPolicy.mode !== "deny_all") {
      throw new ExecutionError("EXECUTION_NETWORK_DENIED", "MockRunner يحاكي شبكة مغلقة فقط.");
    }
    mockWorkspaces.set(input.executionId, new Map());
    cancelledWorkspaces.delete(input.executionId);
    return { externalWorkspaceId: input.executionId, state: "ready" as const };
  }

  async executeCommand(
    workspaceId: string,
    request: CommandRequest,
    callbacks: {
      onStdout(chunk: Uint8Array): Promise<void>;
      onStderr(chunk: Uint8Array): Promise<void>;
      onState(state: string): Promise<void>;
    },
  ): Promise<CommandResult> {
    validateCommandRequest(request);
    const files = mockWorkspaces.get(workspaceId);
    if (!files) throw new ExecutionError("EXECUTION_WORKSPACE_NOT_READY", "مساحة الاختبار غير موجودة.");
    const startedAt = new Date().toISOString();
    await callbacks.onState("running");
    const script = request.argv[2] ?? "";
    if (script.includes("time.sleep")) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await callbacks.onState("timed_out");
      return {
        exitCode: null,
        signal: "SIGTERM",
        startedAt,
        completedAt: new Date().toISOString(),
        stdoutBytes: 0,
        stderrBytes: 0,
        timedOut: true,
      };
    }
    if (script.includes("diagnostic failure")) {
      const stderr = encoder.encode("diagnostic failure\n");
      await callbacks.onStderr(stderr);
      await callbacks.onState("failed");
      return {
        exitCode: 7,
        signal: null,
        startedAt,
        completedAt: new Date().toISOString(),
        stdoutBytes: 0,
        stderrBytes: stderr.byteLength,
        timedOut: false,
      };
    }
    if (cancelledWorkspaces.has(workspaceId)) {
      await callbacks.onState("cancelled");
      return {
        exitCode: null,
        signal: "SIGTERM",
        startedAt,
        completedAt: new Date().toISOString(),
        stdoutBytes: 0,
        stderrBytes: 0,
        timedOut: false,
      };
    }
    const output = script.includes("blocked =") ? "safe\n" : "4\n";
    const stdout = encoder.encode(output);
    files.set("result.txt", stdout);
    await callbacks.onStdout(stdout);
    await callbacks.onState("completed");
    return {
      exitCode: 0,
      signal: null,
      startedAt,
      completedAt: new Date().toISOString(),
      stdoutBytes: stdout.byteLength,
      stderrBytes: 0,
      timedOut: false,
    };
  }

  async uploadFile(workspaceId: string, destination: string, content: AsyncIterable<Uint8Array>) {
    const files = mockWorkspaces.get(workspaceId);
    if (!files) throw new ExecutionError("EXECUTION_WORKSPACE_NOT_READY", "مساحة الاختبار غير موجودة.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of content) {
      total += chunk.byteLength;
      if (total > this.limits.maxSingleFileBytes) throw new ExecutionError("EXECUTION_ARTIFACT_LIMIT", "الملف أكبر من الحد.");
      chunks.push(chunk);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    files.set(normalizeWorkspacePath(destination), body);
  }

  async downloadFile(workspaceId: string, source: string): Promise<AsyncIterable<Uint8Array>> {
    const body = mockWorkspaces.get(workspaceId)?.get(normalizeWorkspacePath(source));
    if (!body) throw new ExecutionError("EXECUTION_ARTIFACT_NOT_FOUND", "ملف الاختبار غير موجود.");
    return (async function* stream() { yield body; })();
  }

  async listFiles(workspaceId: string, root: string) {
    normalizeWorkspacePath(root);
    const files = mockWorkspaces.get(workspaceId);
    if (!files) throw new ExecutionError("EXECUTION_WORKSPACE_NOT_READY", "مساحة الاختبار غير موجودة.");
    return [...files].map(([path, body]) => ({ path, sizeBytes: body.byteLength, type: "file" as const }));
  }

  async terminateProcess(workspaceId: string) {
    cancelledWorkspaces.add(workspaceId);
  }

  async destroyWorkspace(workspaceId: string) {
    mockWorkspaces.delete(workspaceId);
    cancelledWorkspaces.delete(workspaceId);
  }
}
