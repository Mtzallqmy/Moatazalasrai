import type {
  CommandRequest,
  CommandResult,
  ExecutionLimits,
  ExecutionRunner,
  NetworkPolicy,
  RunnerHealth,
  RunnerKind,
} from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";

export abstract class UnavailableExecutionAdapter implements ExecutionRunner {
  abstract readonly kind: RunnerKind;
  protected abstract availability(): { enabled: boolean; configured: boolean; errorCode: string };

  async healthCheck(): Promise<RunnerHealth> {
    const availability = this.availability();
    return {
      ok: false,
      kind: this.kind,
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      capabilities: {
        command: false,
        files: false,
        cancellation: false,
        networkIsolation: false,
        snapshots: false,
        pauseResume: false,
      },
      errorCode: availability.errorCode,
    };
  }

  protected unavailable(): never {
    const state = this.availability();
    throw new ExecutionError(
      "EXECUTION_RUNNER_UNAVAILABLE",
      `مشغل ${this.kind} غير متاح في بيئة النشر الحالية.`,
      false,
      { runnerKind: this.kind, enabled: state.enabled, configured: state.configured, reason: state.errorCode },
    );
  }

  async createWorkspace(_input: {
    executionId: string;
    organizationId: string;
    templateId: string;
    limits: ExecutionLimits;
    networkPolicy: NetworkPolicy;
  }): Promise<{ externalWorkspaceId: string; state: "ready" }> { return this.unavailable(); }
  async executeCommand(
    _workspaceId: string,
    _input: CommandRequest,
    _callbacks: {
      onStdout(chunk: Uint8Array): Promise<void>;
      onStderr(chunk: Uint8Array): Promise<void>;
      onState(state: string): Promise<void>;
    },
  ): Promise<CommandResult> { return this.unavailable(); }
  async uploadFile(_workspaceId: string, _destination: string, _content: AsyncIterable<Uint8Array>): Promise<void> { return this.unavailable(); }
  async downloadFile(_workspaceId: string, _source: string): Promise<AsyncIterable<Uint8Array>> { return this.unavailable(); }
  async listFiles(_workspaceId: string, _root: string): Promise<Array<{ path: string; sizeBytes: number; type: "file" | "directory" }>> { return this.unavailable(); }
  async terminateProcess(_workspaceId: string, _processId?: string): Promise<void> { return this.unavailable(); }
  async destroyWorkspace(_workspaceId: string): Promise<void> { return this.unavailable(); }
}
