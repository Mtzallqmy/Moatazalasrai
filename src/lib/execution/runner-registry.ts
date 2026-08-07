import type { ExecutionRunner } from "@/lib/execution/contracts";
import { ExistingSandboxAdapter } from "@/lib/execution/existing-sandbox-adapter";
import { ApiError } from "@/lib/http/api";

const runners = new Map<string, ExecutionRunner>();
runners.set("existing_sandbox", new ExistingSandboxAdapter());

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
