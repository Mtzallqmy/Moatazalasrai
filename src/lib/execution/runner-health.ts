import { getExecutionRunner, selectedRunnerKind } from "@/lib/execution/runner-registry";
import { platformExecutionLimits } from "@/lib/execution/quota-service";

export async function executionRunnerHealth(organizationId: string) {
  const runner = getExecutionRunner({ organizationId, limits: platformExecutionLimits() });
  const health = await runner.healthCheck();
  return {
    selected: selectedRunnerKind(),
    health,
    ready: health.ok
      && health.capabilities.command
      && health.capabilities.files
      && health.capabilities.cancellation
      && health.capabilities.networkIsolation,
  };
}
