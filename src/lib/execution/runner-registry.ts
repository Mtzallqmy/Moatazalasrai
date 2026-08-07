import type { ExecutionRunner } from "@/lib/execution/contracts";
import { ExistingSandboxAdapter } from "@/lib/execution/existing-sandbox-adapter";
import { ApiError } from "@/lib/http/api";

class ControlPlaneExecutionRunner implements ExecutionRunner {
  readonly kind = "control_plane";
  async health() { return { ok: true }; }
  private unsupported(): never {
    throw new ApiError(422, "EXECUTION_WORKSPACE_UNSUPPORTED", "هذا النوع من التنفيذ لا يستخدم مساحة أوامر عامة.");
  }
  async provision(): Promise<never> { return this.unsupported(); }
  async execute(): Promise<never> { return this.unsupported(); }
  async writeFile(): Promise<never> { return this.unsupported(); }
  async readFile(): Promise<never> { return this.unsupported(); }
  async listFiles(): Promise<never> { return this.unsupported(); }
  async cancel() { return; }
  async cleanup() { return; }
}

const runners = new Map<string, ExecutionRunner>();
runners.set("existing_sandbox", new ExistingSandboxAdapter());
runners.set("control_plane", new ControlPlaneExecutionRunner());

export function getExecutionRunner(kind: string): ExecutionRunner {
  const runner = runners.get(kind);
  if (!runner) throw new ApiError(422, "EXECUTION_RUNNER_UNSUPPORTED", "مشغل التنفيذ المطلوب غير مدعوم.");
  return runner;
}

export function listExecutionRunners() {
  return [...runners.values()];
}

export async function executionRunnerHealth(kind: string) {
  return getExecutionRunner(kind).health();
}
