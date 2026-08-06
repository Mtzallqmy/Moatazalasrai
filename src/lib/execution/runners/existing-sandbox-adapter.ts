import { randomUUID } from "node:crypto";
import type {
  CommandRequest,
  CommandResult,
  ExecutionLimits,
  ExecutionRunner,
  NetworkPolicy,
  RunnerHealth,
} from "@/lib/execution/contracts";
import { ExecutionError, asExecutionError } from "@/lib/execution/errors";
import { normalizeWorkspacePath, validateCommandRequest } from "@/lib/execution/validation";
import {
  createRunnerWorkspace,
  deleteRunnerWorkspace,
  getRunnerExecution,
  getRunnerHealth,
  listRunnerFiles,
  readRunnerFile,
  startRunnerExecution,
  stopRunnerExecution,
  writeRunnerFile,
} from "@/lib/sandbox/runner-client";

const encoder = new TextEncoder();

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function collect(content: AsyncIterable<Uint8Array>, maximum: number) {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of content) {
    bytes += chunk.byteLength;
    if (bytes > maximum) throw new ExecutionError("EXECUTION_ARTIFACT_LIMIT", "تجاوز الملف حد الرفع إلى مساحة التنفيذ.");
    chunks.push(chunk);
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class ExistingSandboxAdapter implements ExecutionRunner {
  readonly kind = "existing" as const;

  constructor(
    private readonly organizationId: string,
    private readonly limits: ExecutionLimits,
  ) {}

  async healthCheck(): Promise<RunnerHealth> {
    const started = Date.now();
    try {
      const result = await getRunnerHealth();
      return {
        ok: result.ok,
        kind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        capabilities: {
          command: true,
          files: true,
          cancellation: true,
          networkIsolation: result.networkIsolation !== false,
          snapshots: false,
          pauseResume: false,
        },
      };
    } catch (error) {
      return {
        ok: false,
        kind: this.kind,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        capabilities: {
          command: false,
          files: false,
          cancellation: false,
          networkIsolation: false,
          snapshots: false,
          pauseResume: false,
        },
        errorCode: asExecutionError(error).code,
      };
    }
  }

  async createWorkspace(input: {
    executionId: string;
    organizationId: string;
    templateId: string;
    limits: ExecutionLimits;
    networkPolicy: NetworkPolicy;
  }) {
    if (input.organizationId !== this.organizationId) {
      throw new ExecutionError("EXECUTION_RUNNER_PROTOCOL_ERROR", "مؤسسة مساحة التنفيذ لا تطابق سياق المشغل.");
    }
    if (input.networkPolicy.mode !== "deny_all") {
      throw new ExecutionError("EXECUTION_NETWORK_DENIED", "المشغل الحالي لا يسمح بالشبكة في نواة التنفيذ الأولى.");
    }
    const result = await createRunnerWorkspace({
      tenantId: this.organizationId,
      workspaceId: input.executionId,
      template: input.templateId,
      diskLimitBytes: input.limits.diskBytes,
      networkMode: "disabled",
    });
    return { externalWorkspaceId: result.workspaceId, state: result.status };
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
    const input = validateCommandRequest(request);
    const externalExecutionId = randomUUID();
    const started = await startRunnerExecution({
      tenantId: this.organizationId,
      workspaceId,
      executionId: externalExecutionId,
      argv: input.argv,
      workingDirectory: input.cwd,
      timeoutMs: Math.min(input.timeoutMs, this.limits.timeoutMs),
      maxOutputBytes: this.limits.maxOutputBytes,
      environment: input.environment,
      stdin: input.stdin,
    });
    await callbacks.onState("running");
    let after = 0;
    const deadline = Date.now() + Math.min(input.timeoutMs, this.limits.timeoutMs) + 30_000;
    while (Date.now() < deadline) {
      const snapshot = await getRunnerExecution({
        tenantId: this.organizationId,
        externalWorkspaceId: workspaceId,
        externalExecutionId: started.executionId,
        after,
      });
      for (const event of snapshot.events) {
        after = Math.max(after, event.sequence);
        const text = typeof event.payload.text === "string" ? event.payload.text : "";
        if (!text) continue;
        if (event.stream === "stderr") await callbacks.onStderr(encoder.encode(text));
        else if (event.stream === "stdout") await callbacks.onStdout(encoder.encode(text));
      }
      if (snapshot.status !== "running") {
        await callbacks.onState(snapshot.status);
        return {
          exitCode: snapshot.exitCode,
          signal: snapshot.signal ?? null,
          startedAt: snapshot.startedAt,
          completedAt: snapshot.completedAt ?? new Date().toISOString(),
          stdoutBytes: snapshot.stdoutBytes,
          stderrBytes: snapshot.stderrBytes,
          timedOut: snapshot.status === "timed_out",
        };
      }
      await sleep(300);
    }
    await stopRunnerExecution({
      tenantId: this.organizationId,
      externalWorkspaceId: workspaceId,
      externalExecutionId: started.executionId,
    }).catch(() => undefined);
    throw new ExecutionError("EXECUTION_RUNNER_TIMEOUT", "لم يؤكد المشغل انتهاء العملية ضمن المهلة.", true);
  }

  async uploadFile(workspaceId: string, destination: string, content: AsyncIterable<Uint8Array>) {
    const body = await collect(content, this.limits.maxSingleFileBytes);
    await writeRunnerFile({
      tenantId: this.organizationId,
      externalWorkspaceId: workspaceId,
      path: normalizeWorkspacePath(destination),
      content: Buffer.from(body).toString("base64"),
      encoding: "base64",
      overwrite: false,
    });
  }

  async downloadFile(workspaceId: string, source: string): Promise<AsyncIterable<Uint8Array>> {
    const result = await readRunnerFile({
      tenantId: this.organizationId,
      externalWorkspaceId: workspaceId,
      path: normalizeWorkspacePath(source),
      maxBytes: this.limits.maxSingleFileBytes,
    });
    const bytes = result.encoding === "base64"
      ? new Uint8Array(Buffer.from(result.content, "base64"))
      : encoder.encode(result.content);
    return (async function* stream() { yield bytes; })();
  }

  async listFiles(workspaceId: string, root: string) {
    const result = await listRunnerFiles({
      tenantId: this.organizationId,
      externalWorkspaceId: workspaceId,
      path: normalizeWorkspacePath(root),
      depth: 10,
    });
    return result.files.slice(0, this.limits.maxFiles).map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      type: file.isDirectory ? "directory" as const : "file" as const,
    }));
  }

  async terminateProcess(workspaceId: string, processId?: string) {
    if (!processId) return;
    await stopRunnerExecution({
      tenantId: this.organizationId,
      externalWorkspaceId: workspaceId,
      externalExecutionId: processId,
    });
  }

  async destroyWorkspace(workspaceId: string) {
    await deleteRunnerWorkspace({ tenantId: this.organizationId, externalWorkspaceId: workspaceId });
  }
}
