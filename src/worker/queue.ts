import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { getPostgresPool } from "@/db/pool";
import type {
  AgentRunResumePayload,
  AgentTeamRunPayload,
  BrowserResumePayload,
  BrowserTaskPayload,
  DocumentParsePayload,
  NotificationDispatchPayload,
  SandboxCleanupPayload,
  SandboxExecutionPayload,
  SandboxResumePayload,
  SandboxWorkspacePayload,
  TelegramUpdateProcessPayload,
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

export function enqueueTelegramUpdateProcess(payload: TelegramUpdateProcessPayload) {
  return addJob("telegram-update-process", payload, {
    queueName: "telegram-central",
    maxAttempts: 5,
    jobKey: `telegram-update-process:${payload.updateRowId}`,
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
