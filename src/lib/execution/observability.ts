import { metrics, type Attributes } from "@opentelemetry/api";
import type { ExecutionStatus, RunnerKind } from "@/lib/execution/contracts";

const meter = metrics.getMeter("moataz-execution-kernel");
const created = meter.createCounter("executions_created_total");
const completed = meter.createCounter("executions_completed_total");
const failed = meter.createCounter("executions_failed_total");
const timedOut = meter.createCounter("executions_timed_out_total");
const cancelled = meter.createCounter("executions_cancelled_total");
const duration = meter.createHistogram("execution_duration_ms", { unit: "ms" });
const provisionDuration = meter.createHistogram("workspace_provision_duration_ms", { unit: "ms" });
const activeWorkspaces = meter.createUpDownCounter("active_workspaces");
const orphanedWorkspaces = meter.createUpDownCounter("orphaned_workspaces");
const artifactBytes = meter.createCounter("artifact_bytes_total", { unit: "By" });
const credentialProxyRequests = meter.createCounter("credential_proxy_requests_total");
const credentialProxyDenied = meter.createCounter("credential_proxy_denied_total");
const queueDelay = meter.createHistogram("queue_delay_ms", { unit: "ms" });

function attributes(input: {
  kind?: string;
  runnerKind?: RunnerKind;
  status?: ExecutionStatus;
  retryCount?: number;
  timeout?: boolean;
}): Attributes {
  return {
    ...(input.kind ? { "execution.kind": input.kind.slice(0, 120) } : {}),
    ...(input.runnerKind ? { "runner.kind": input.runnerKind } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.retryCount === undefined ? {} : { "retry.count": input.retryCount }),
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
  };
}

export function recordExecutionCreated(input: { kind: string; runnerKind: RunnerKind }) {
  created.add(1, attributes(input));
}

export function recordExecutionTerminal(input: {
  kind: string;
  runnerKind: RunnerKind;
  status: Extract<ExecutionStatus, "completed" | "failed" | "timed_out" | "cancelled">;
  durationMs: number;
  retryCount: number;
}) {
  const attrs = attributes(input);
  if (input.status === "completed") completed.add(1, attrs);
  if (input.status === "failed") failed.add(1, attrs);
  if (input.status === "timed_out") timedOut.add(1, attrs);
  if (input.status === "cancelled") cancelled.add(1, attrs);
  duration.record(Math.max(0, input.durationMs), attrs);
}

export function recordProvisionDuration(input: { runnerKind: RunnerKind; durationMs: number }) {
  provisionDuration.record(Math.max(0, input.durationMs), attributes(input));
}

export function recordWorkspaceDelta(input: { runnerKind: RunnerKind; delta: 1 | -1; orphaned?: boolean }) {
  activeWorkspaces.add(input.delta, attributes(input));
  if (input.orphaned) orphanedWorkspaces.add(input.delta, attributes(input));
}

export function recordArtifactBytes(input: { kind: string; runnerKind: RunnerKind; bytes: number }) {
  artifactBytes.add(Math.max(0, input.bytes), attributes(input));
}

export function recordCredentialProxy(input: { providerKind: string; allowed: boolean; status?: number }) {
  const attrs: Attributes = {
    "provider.kind": input.providerKind.slice(0, 80),
    allowed: input.allowed,
    ...(input.status === undefined ? {} : { "http.response.status_code": input.status }),
  };
  credentialProxyRequests.add(1, attrs);
  if (!input.allowed) credentialProxyDenied.add(1, attrs);
}

export function recordQueueDelay(input: { kind: string; runnerKind: RunnerKind; milliseconds: number }) {
  queueDelay.record(Math.max(0, input.milliseconds), attributes(input));
}
