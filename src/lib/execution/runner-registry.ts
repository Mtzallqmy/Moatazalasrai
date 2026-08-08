import { runnerKindSchema, type ExecutionLimits, type ExecutionRunner, type RunnerKind } from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";
import { DaytonaExecutionAdapter } from "@/lib/execution/runners/daytona-adapter";
import { E2BExecutionAdapter } from "@/lib/execution/runners/e2b-adapter";
import { ExistingSandboxAdapter } from "@/lib/execution/runners/existing-sandbox-adapter";
import { GVisorExecutionAdapter } from "@/lib/execution/runners/gvisor-adapter";
import { MockExecutionRunner } from "@/lib/execution/runners/mock-runner";

export function executionKernelEnabled() {
  return process.env.EXECUTION_KERNEL_ENABLED === "true";
}

export function assertExecutionKernelEnabled() {
  if (!executionKernelEnabled()) {
    throw new ExecutionError("EXECUTION_KERNEL_DISABLED", "نواة التنفيذ غير مفعلة في هذه البيئة.");
  }
}

export function selectedRunnerKind(): RunnerKind {
  return runnerKindSchema.parse(process.env.EXECUTION_RUNNER?.trim() || "existing");
}

export function getExecutionRunner(input: {
  organizationId: string;
  limits: ExecutionLimits;
}): ExecutionRunner {
  if (process.env.NODE_ENV === "test" && process.env.EXECUTION_TEST_RUNNER === "mock") {
    return new MockExecutionRunner(input.limits);
  }
  switch (selectedRunnerKind()) {
    case "existing": return new ExistingSandboxAdapter(input.organizationId, input.limits);
    case "gvisor": return new GVisorExecutionAdapter();
    case "e2b": return new E2BExecutionAdapter();
    case "daytona": return new DaytonaExecutionAdapter();
  }
}

export async function requireHealthyExecutionRunner(input: {
  organizationId: string;
  limits: ExecutionLimits;
}) {
  const runner = getExecutionRunner(input);
  const health = await runner.healthCheck();
  if (!health.ok) {
    throw new ExecutionError(
      "EXECUTION_RUNNER_UNAVAILABLE",
      "مشغل التنفيذ المحدد غير جاهز.",
      true,
      { runnerKind: runner.kind, errorCode: health.errorCode },
    );
  }
  if (!health.capabilities.command || !health.capabilities.files || !health.capabilities.cancellation || !health.capabilities.networkIsolation) {
    throw new ExecutionError(
      "EXECUTION_RUNNER_UNAVAILABLE",
      "مشغل التنفيذ لا يحقق عقد العزل والإلغاء والملفات المطلوب.",
      false,
      { runnerKind: runner.kind, capabilities: health.capabilities },
    );
  }
  return { runner, health };
}
