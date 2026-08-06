import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { getPostgresPool } from "@/db/pool";
import type {
  AgentRunResumePayload,
  AgentTeamRunPayload,
  BrowserResumePayload,
  BrowserTaskPayload,
  DocumentParsePayload,
  ExecutionMaintenancePayload,
  ExecutionTaskPayload,
  NotificationDispatchPayload,
  SandboxCleanupPayload,
  SandboxExecutionPayload,
  SandboxResumePayload,
  SandboxWorkspacePayload,
} from "@/worker/schemas";

let workerUtilsPromise: Promise<WorkerUtils> | null = null;

export function getWorkerUtils() {
  if (!workerUtilsPromise) {
    workerUtilsPromise = makeWorkerUtils({ pgPool: getPostgresPool() }).catch((error) => {
      workerUtilsPromise = null;
      throw error;
    });
  }
  return workerUtilsPromise;
}

export async function releaseWorkerUtils() {
  const promise = workerUtilsPromise;
  workerUtilsPromise = null;
  if (promise) await (await promise).release();
}

async function addJob(name: string, payload: unknown, options: {
  queueName: string;
  maxAttempts?: number;
  jobKey: string;
  jobKeyMode?: "replace" | "preserve_run_at" | "unsafe_dedupe";
  runAt?: Date;
}) {
  const worker = await getWorkerUtils();
  const job = await worker.addJob(name, payload, {
    queueName: options.queueName,
    maxAttempts: options.maxAttempts ?? 5,
    jobKey: options.jobKey,
    jobKeyMode: options.jobKeyMode ?? "unsafe_dedupe",
    runAt: options.runAt,
  });
  return { jobId: String(job.id) };
}

export function enqueueAgentTeamRun(payload: AgentTeamRunPayload) {
  return addJob("agent-team-run", payload, {
    queueName: "agent-teams",
    jobKey: `agent-team-run:${payload.teamRunId}`,
  });
}

export function enqueueDocumentParse(payload: DocumentParsePayload) {
  return addJob("document-parse", payload, {
    queueName: "rag",
    jobKey: `document-parse:${payload.documentId}`,
    jobKeyMode: "replace",
  });
}

export function enqueueAgentRunResume(payload: AgentRunResumePayload) {
  return addJob("agent-run-resume", payload, {
    queueName: "agent-approvals",
    jobKey: `agent-run-resume:${payload.approvalId}`,
  });
}

export function enqueueNotificationDispatch(payload: NotificationDispatchPayload) {
  return addJob("notification-dispatch", payload, {
    queueName: `notifications:${payload.organizationId}`,
    maxAttempts: 5,
    jobKey: `notification-dispatch:${payload.eventId}`,
    jobKeyMode: "unsafe_dedupe",
  });
}

export function enqueueSandboxCreate(payload: SandboxWorkspacePayload) {
  return addJob("sandbox-create", payload, {
    queueName: `sandbox:${payload.organizationId}`,
    jobKey: `sandbox-create:${payload.workspaceId}`,
  });
}

export function enqueueSandboxExecute(payload: SandboxExecutionPayload) {
  return addJob("sandbox-execute", payload, {
    queueName: `sandbox:${payload.organizationId}`,
    maxAttempts: 3,
    jobKey: `sandbox-execute:${payload.executionId}`,
  });
}

export function enqueueSandboxResume(payload: SandboxResumePayload) {
  return addJob("sandbox-resume", payload, {
    queueName: `sandbox:${payload.organizationId}`,
    maxAttempts: 3,
    jobKey: `sandbox-resume:${payload.approvalId}`,
  });
}

export function enqueueSandboxReset(payload: SandboxWorkspacePayload) {
  return addJob("sandbox-reset", payload, {
    queueName: `sandbox:${payload.organizationId}`,
    maxAttempts: 3,
    jobKey: `sandbox-reset:${payload.workspaceId}`,
  });
}

export function enqueueSandboxCleanup(payload: SandboxCleanupPayload = {}) {
  return addJob("sandbox-cleanup", payload, {
    queueName: "sandbox-maintenance",
    maxAttempts: 3,
    jobKey: `sandbox-cleanup:${payload.organizationId ?? "all"}`,
    jobKeyMode: "replace",
  });
}

export function enqueueBrowserTask(payload: BrowserTaskPayload) {
  return addJob("browser-task-execute", payload, {
    queueName: `browser:${payload.organizationId}`,
    maxAttempts: 3,
    jobKey: `browser-task-execute:${payload.browserTaskId}`,
  });
}

export function enqueueBrowserResume(payload: BrowserResumePayload) {
  return addJob("browser-task-resume", payload, {
    queueName: `browser:${payload.organizationId}`,
    maxAttempts: 3,
    jobKey: `browser-task-resume:${payload.approvalId}`,
  });
}

export function enqueueExecutionProvision(payload: ExecutionTaskPayload) {
  return addJob("execution-provision", payload, {
    queueName: "execution-provision",
    maxAttempts: 3,
    jobKey: `execution:provision:${payload.jobId}`,
  });
}

export function enqueueExecutionRunStep(payload: ExecutionTaskPayload) {
  return addJob("execution-run-step", payload, {
    queueName: "execution-run",
    maxAttempts: 3,
    jobKey: `execution:run:${payload.jobId}:1`,
  });
}

export function enqueueExecutionCollectArtifacts(payload: ExecutionTaskPayload) {
  return addJob("execution-collect-artifacts", payload, {
    queueName: "execution-run",
    maxAttempts: 3,
    jobKey: `execution:artifacts:${payload.jobId}`,
  });
}

export function enqueueExecutionCancel(payload: ExecutionTaskPayload) {
  return addJob("execution-cancel", payload, {
    queueName: "execution-cleanup",
    maxAttempts: 5,
    jobKey: `execution:cancel:${payload.jobId}`,
  });
}

export function enqueueExecutionCleanup(payload: ExecutionTaskPayload) {
  return addJob("execution-cleanup", payload, {
    queueName: "execution-cleanup",
    maxAttempts: 10,
    jobKey: `execution:cleanup:${payload.jobId}`,
  });
}

export function enqueueExecutionReconcile(payload: ExecutionMaintenancePayload) {
  return addJob("execution-reconcile", payload, {
    queueName: "execution-maintenance",
    maxAttempts: 3,
    jobKey: "execution:reconcile",
    jobKeyMode: "replace",
  });
}

export function enqueueExecutionExpire(payload: ExecutionMaintenancePayload) {
  return addJob("execution-expire", payload, {
    queueName: "execution-maintenance",
    maxAttempts: 3,
    jobKey: "execution:expire",
    jobKeyMode: "replace",
  });
}
