import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { getPostgresPool, getSystemPostgresPool } from "@/db/pool";
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
  TelegramUpdatePayload,
  WhatsAppChannelUpdatePayload,
} from "@/worker/schemas";

let integrationWorkerUtilsPromise: Promise<WorkerUtils> | null = null;

/**
 * Integration-test compatibility only. Production enqueue paths below use the
 * SECURITY DEFINER boundary instead of exposing Graphile Worker internals to
 * the tenant/application database role.
 */
export function getWorkerUtils() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("WORKER_UTILS_TEST_ONLY");
  }
  integrationWorkerUtilsPromise ??= makeWorkerUtils({ pgPool: getSystemPostgresPool() }).catch((error) => {
    integrationWorkerUtilsPromise = null;
    throw error;
  });
  return integrationWorkerUtilsPromise;
}

export async function releaseWorkerUtils() {
  const promise = integrationWorkerUtilsPromise;
  integrationWorkerUtilsPromise = null;
  if (promise) await (await promise).release();
}

async function addJob(name: string, payload: unknown, options: {
  queueName: string;
  maxAttempts?: number;
  jobKey: string;
  jobKeyMode?: "replace" | "preserve_run_at" | "unsafe_dedupe";
  runAt?: Date;
}) {
  const result = await getPostgresPool().query<{ id: string }>(`
    SELECT app_security.enqueue_job(
      $1::text,
      $2::json,
      $3::text,
      $4::timestamptz,
      $5::integer,
      $6::text,
      $7::integer,
      $8::text
    )::text AS id
  `, [
    name,
    JSON.stringify(payload),
    options.queueName,
    options.runAt ?? new Date(),
    options.maxAttempts ?? 5,
    options.jobKey,
    0,
    options.jobKeyMode ?? "unsafe_dedupe",
  ]);
  const jobId = result.rows[0]?.id;
  if (!jobId) throw new Error("GRAPHILE_JOB_ENQUEUE_FAILED");
  return { jobId };
}

export function enqueueAgentTeamRun(payload: AgentTeamRunPayload) {
  return addJob("agent-team-run", payload, { queueName: "agent-teams", jobKey: `agent-team-run:${payload.teamRunId}` });
}

export function enqueueDocumentParse(payload: DocumentParsePayload) {
  return addJob("document-parse", payload, { queueName: "rag", jobKey: `document-parse:${payload.documentId}`, jobKeyMode: "replace" });
}

export function enqueueAttachmentProcess(payload: { organizationId: string; attachmentId: string }) {
  return addJob("attachment-process", payload, { queueName: `files:${payload.organizationId}`, maxAttempts: 3, jobKey: `attachment-process:${payload.attachmentId}`, jobKeyMode: "replace" });
}

export function enqueueAgentRunResume(payload: AgentRunResumePayload) {
  return addJob("agent-run-resume", payload, { queueName: "agent-approvals", jobKey: `agent-run-resume:${payload.approvalId}` });
}

export function enqueueNotificationDispatch(payload: NotificationDispatchPayload) {
  return addJob("notification-dispatch", payload, { queueName: `notifications:${payload.organizationId}`, maxAttempts: 5, jobKey: `notification-dispatch:${payload.eventId}`, jobKeyMode: "unsafe_dedupe" });
}

export function enqueueTelegramUpdate(payload: TelegramUpdatePayload) {
  const scope = payload.integrationId ?? "central";
  return addJob("telegram-update-process", payload, {
    queueName: payload.organizationId ? `telegram:${payload.organizationId}` : "telegram-central",
    maxAttempts: 5,
    jobKey: `telegram-update:${scope}:${payload.updateId}`,
    jobKeyMode: "unsafe_dedupe",
  });
}

export function enqueueWhatsAppChannelUpdate(payload: WhatsAppChannelUpdatePayload) {
  return addJob("whatsapp-channel-update", payload, { queueName: "whatsapp-central", maxAttempts: 5, jobKey: `whatsapp-channel-update:${payload.eventRowId}`, jobKeyMode: "unsafe_dedupe" });
}

export function enqueueSandboxCreate(payload: SandboxWorkspacePayload) {
  return addJob("sandbox-create", payload, { queueName: `sandbox:${payload.organizationId}`, jobKey: `sandbox-create:${payload.workspaceId}` });
}

export function enqueueSandboxExecute(payload: SandboxExecutionPayload) {
  return addJob("sandbox-execute", payload, { queueName: `sandbox:${payload.organizationId}`, maxAttempts: 3, jobKey: `sandbox-execute:${payload.executionId}` });
}

export function enqueueSandboxResume(payload: SandboxResumePayload) {
  return addJob("sandbox-resume", payload, { queueName: `sandbox:${payload.organizationId}`, maxAttempts: 3, jobKey: `sandbox-resume:${payload.approvalId}` });
}

export function enqueueSandboxReset(payload: SandboxWorkspacePayload) {
  return addJob("sandbox-reset", payload, { queueName: `sandbox:${payload.organizationId}`, maxAttempts: 3, jobKey: `sandbox-reset:${payload.workspaceId}` });
}

export function enqueueSandboxCleanup(payload: SandboxCleanupPayload = {}) {
  return addJob("sandbox-cleanup", payload, { queueName: "sandbox-maintenance", maxAttempts: 3, jobKey: `sandbox-cleanup:${payload.organizationId ?? "all"}`, jobKeyMode: "replace" });
}

export function enqueueBrowserTask(payload: BrowserTaskPayload) {
  return addJob("browser-task-execute", payload, { queueName: `browser:${payload.organizationId}`, maxAttempts: 3, jobKey: `browser-task-execute:${payload.browserTaskId}` });
}

export function enqueueBrowserResume(payload: BrowserResumePayload) {
  return addJob("browser-task-resume", payload, { queueName: `browser:${payload.organizationId}`, maxAttempts: 3, jobKey: `browser-task-resume:${payload.approvalId}` });
}

export function enqueueExecutionProvision(payload: ExecutionTaskPayload) {
  return addJob("execution-provision", payload, { queueName: "execution-provision", maxAttempts: 3, jobKey: `execution:provision:${payload.jobId}` });
}

export function enqueueExecutionRunStep(payload: ExecutionTaskPayload) {
  return addJob("execution-run-step", payload, { queueName: "execution-run", maxAttempts: 3, jobKey: `execution:run:${payload.jobId}:1` });
}

export function enqueueExecutionCollectArtifacts(payload: ExecutionTaskPayload) {
  return addJob("execution-collect-artifacts", payload, { queueName: "execution-run", maxAttempts: 3, jobKey: `execution:artifacts:${payload.jobId}` });
}

export function enqueueExecutionCancel(payload: ExecutionTaskPayload) {
  return addJob("execution-cancel", payload, { queueName: "execution-cleanup", maxAttempts: 5, jobKey: `execution:cancel:${payload.jobId}` });
}

export function enqueueExecutionCleanup(payload: ExecutionTaskPayload) {
  return addJob("execution-cleanup", payload, { queueName: "execution-cleanup", maxAttempts: 10, jobKey: `execution:cleanup:${payload.jobId}` });
}

export function enqueueExecutionReconcile(payload: ExecutionMaintenancePayload) {
  return addJob("execution-reconcile", payload, { queueName: "execution-maintenance", maxAttempts: 3, jobKey: "execution:reconcile", jobKeyMode: "replace" });
}

export function enqueueExecutionExpire(payload: ExecutionMaintenancePayload) {
  return addJob("execution-expire", payload, { queueName: "execution-maintenance", maxAttempts: 3, jobKey: "execution:expire", jobKeyMode: "replace" });
}
