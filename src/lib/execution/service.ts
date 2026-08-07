import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  executionJobs,
  executionUsage,
  executionWorkspaces,
  type ExecutionLimits,
  type ExecutionNetworkPolicy,
} from "@/db/execution-schema";
import { auditLogs } from "@/db/schema";
import { credentialBroker } from "@/lib/execution/credential-broker";
import { appendExecutionEvent } from "@/lib/execution/events";
import { getExecutionRunner } from "@/lib/execution/runner-registry";
import { ApiError } from "@/lib/http/api";

const terminal = new Set(["completed", "failed", "timed_out", "cancelled"]);

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  timeoutMs: 300_000,
  memoryBytes: 512 * 1024 * 1024,
  diskBytes: 512 * 1024 * 1024,
  maxArtifactBytes: 25 * 1024 * 1024,
  maxOutputBytes: 2 * 1024 * 1024,
};

export function clampExecutionLimits(input?: Partial<ExecutionLimits>): ExecutionLimits {
  return {
    timeoutMs: Math.min(Math.max(input?.timeoutMs ?? DEFAULT_EXECUTION_LIMITS.timeoutMs, 1_000), 1_800_000),
    memoryBytes: Math.min(Math.max(input?.memoryBytes ?? DEFAULT_EXECUTION_LIMITS.memoryBytes, 64 * 1024 * 1024), 8 * 1024 * 1024 * 1024),
    diskBytes: Math.min(Math.max(input?.diskBytes ?? DEFAULT_EXECUTION_LIMITS.diskBytes, 16 * 1024 * 1024), 10 * 1024 * 1024 * 1024),
    maxArtifactBytes: Math.min(Math.max(input?.maxArtifactBytes ?? DEFAULT_EXECUTION_LIMITS.maxArtifactBytes, 1_024), 100 * 1024 * 1024),
    maxOutputBytes: Math.min(Math.max(input?.maxOutputBytes ?? DEFAULT_EXECUTION_LIMITS.maxOutputBytes, 1_024), 20 * 1024 * 1024),
  };
}

export function normalizeNetworkPolicy(input?: Partial<ExecutionNetworkPolicy>): ExecutionNetworkPolicy {
  const mode = input?.mode ?? "deny_all";
  const hosts = [...new Set((input?.hosts ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean))];
  if (mode === "deny_all" && hosts.length) throw new ApiError(422, "EXECUTION_NETWORK_POLICY_INVALID", "سياسة منع الشبكة لا تقبل قائمة مضيفين.");
  if (mode === "allowlist" && hosts.some((host) => host === "*" || host.includes("/") || host.includes("://"))) {
    throw new ApiError(422, "EXECUTION_NETWORK_HOST_INVALID", "قائمة الشبكة تحتوي مضيفًا غير صالح.");
  }
  return { mode, hosts };
}

export async function createExecutionJob(input: {
  organizationId: string;
  userId: string;
  executionKind: string;
  runnerKind: string;
  title?: string;
  idempotencyKey: string;
  input?: Record<string, unknown>;
  template?: string;
  limits?: Partial<ExecutionLimits>;
  networkPolicy?: Partial<ExecutionNetworkPolicy>;
  needsWorkspace?: boolean;
}) {
  credentialBroker.assertNoWorkspaceSecrets(input.input);
  const limits = clampExecutionLimits(input.limits);
  const networkPolicy = normalizeNetworkPolicy(input.networkPolicy);
  const runner = getExecutionRunner(input.runnerKind);
  const health = await runner.health();
  if (!health.ok) throw new ApiError(503, "EXECUTION_RUNNER_UNHEALTHY", "مشغل التنفيذ غير جاهز حاليًا.");

  const [existing] = await db().select().from(executionJobs).where(and(
    eq(executionJobs.organizationId, input.organizationId),
    eq(executionJobs.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (existing) return existing;

  const now = new Date();
  const result = await db().transaction(async (tx) => {
    const workspace = input.needsWorkspace === false ? null : (await tx.insert(executionWorkspaces).values({
      organizationId: input.organizationId,
      userId: input.userId,
      runnerKind: input.runnerKind,
      template: input.template ?? "moataz-code",
      status: "provisioning",
      networkPolicy,
      limits,
      metadata: { executionKind: input.executionKind },
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + Math.max(limits.timeoutMs * 2, 60 * 60_000)),
    }).returning())[0];
    if (input.needsWorkspace !== false && !workspace) throw new Error("EXECUTION_WORKSPACE_CREATE_FAILED");

    const [job] = await tx.insert(executionJobs).values({
      organizationId: input.organizationId,
      userId: input.userId,
      workspaceId: workspace?.id,
      executionKind: input.executionKind,
      runnerKind: input.runnerKind,
      status: "queued",
      title: input.title?.slice(0, 240),
      idempotencyKey: input.idempotencyKey,
      input: input.input ?? {},
      limits,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!job) throw new Error("EXECUTION_JOB_CREATE_FAILED");
    await tx.insert(executionUsage).values({ organizationId: input.organizationId, executionJobId: job.id });
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "execution.job_created",
      resourceType: "execution_job",
      resourceId: job.id,
      metadata: { executionKind: input.executionKind, runnerKind: input.runnerKind },
    });
    return job;
  });
  await appendExecutionEvent({ organizationId: input.organizationId, executionJobId: result.id, type: "status", payload: { status: "queued" } });
  return result;
}

export async function getExecutionJob(input: { organizationId: string; userId: string; role: string; executionJobId: string }) {
  const [job] = await db().select().from(executionJobs).where(and(
    eq(executionJobs.id, input.executionJobId),
    eq(executionJobs.organizationId, input.organizationId),
    input.role === "member" ? eq(executionJobs.userId, input.userId) : undefined,
  )).limit(1);
  if (!job) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
  return job;
}

export async function provisionExecutionWorkspace(input: { organizationId: string; executionJobId: string }) {
  const [job] = await db().select().from(executionJobs).where(and(
    eq(executionJobs.id, input.executionJobId),
    eq(executionJobs.organizationId, input.organizationId),
  )).limit(1);
  if (!job) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
  if (!job.workspaceId) return null;
  const [workspace] = await db().select().from(executionWorkspaces).where(and(
    eq(executionWorkspaces.id, job.workspaceId),
    eq(executionWorkspaces.organizationId, input.organizationId),
  )).limit(1);
  if (!workspace) throw new ApiError(409, "EXECUTION_WORKSPACE_MISSING", "مساحة التنفيذ غير موجودة.");
  if (workspace.status === "ready" && workspace.externalWorkspaceRef) return workspace;
  const runner = getExecutionRunner(job.runnerKind);
  const handle = await runner.provision({
    organizationId: input.organizationId,
    userId: job.userId ?? "system",
    executionJobId: job.id,
    workspaceId: workspace.id,
    template: workspace.template,
    networkPolicy: workspace.networkPolicy,
    limits: workspace.limits,
  });
  const [updated] = await db().update(executionWorkspaces).set({
    status: handle.status,
    externalWorkspaceRef: handle.externalRef,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(executionWorkspaces.id, workspace.id), eq(executionWorkspaces.organizationId, input.organizationId))).returning();
  await appendExecutionEvent({ organizationId: input.organizationId, executionJobId: job.id, type: "workspace", payload: { status: handle.status } });
  return updated ?? workspace;
}

export async function markExecutionStatus(input: {
  organizationId: string;
  executionJobId: string;
  status: string;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorReference?: string | null;
}) {
  const completedAt = terminal.has(input.status) ? new Date() : undefined;
  const [updated] = await db().update(executionJobs).set({
    status: input.status,
    result: input.result === undefined ? undefined : input.result,
    errorCode: input.errorCode === undefined ? undefined : input.errorCode,
    errorReference: input.errorReference === undefined ? undefined : input.errorReference,
    startedAt: input.status === "running" ? new Date() : undefined,
    completedAt,
    updatedAt: new Date(),
  }).where(and(eq(executionJobs.id, input.executionJobId), eq(executionJobs.organizationId, input.organizationId))).returning();
  if (!updated) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
  await appendExecutionEvent({ organizationId: input.organizationId, executionJobId: input.executionJobId, type: "status", payload: { status: input.status, errorCode: input.errorCode ?? undefined } });
  return updated;
}

export async function requestExecutionCancellation(input: { organizationId: string; executionJobId: string; userId: string }) {
  const [job] = await db().select().from(executionJobs).where(and(
    eq(executionJobs.id, input.executionJobId),
    eq(executionJobs.organizationId, input.organizationId),
  )).limit(1);
  if (!job) throw new ApiError(404, "EXECUTION_JOB_NOT_FOUND", "مهمة التنفيذ غير موجودة.");
  if (terminal.has(job.status)) return job;
  const [updated] = await db().update(executionJobs).set({
    status: "cancel_requested",
    cancelRequestedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(executionJobs.id, job.id), eq(executionJobs.organizationId, input.organizationId))).returning();
  await appendExecutionEvent({ organizationId: input.organizationId, executionJobId: job.id, type: "status", payload: { status: "cancel_requested" } });
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.userId,
    action: "execution.cancel_requested",
    resourceType: "execution_job",
    resourceId: job.id,
    metadata: {},
  });
  return updated ?? job;
}

export async function cancelExecutionRuntime(input: { organizationId: string; executionJobId: string }) {
  const [job] = await db().select().from(executionJobs).where(and(
    eq(executionJobs.id, input.executionJobId),
    eq(executionJobs.organizationId, input.organizationId),
  )).limit(1);
  if (!job || terminal.has(job.status)) return job ?? null;
  if (job.workspaceId) {
    const [workspace] = await db().select().from(executionWorkspaces).where(and(
      eq(executionWorkspaces.id, job.workspaceId), eq(executionWorkspaces.organizationId, input.organizationId),
    )).limit(1);
    if (workspace?.externalWorkspaceRef) {
      const runner = getExecutionRunner(job.runnerKind);
      await runner.cancel({
        organizationId: input.organizationId,
        userId: job.userId ?? "system",
        executionJobId: job.id,
        workspaceId: workspace.id,
        template: workspace.template,
        networkPolicy: workspace.networkPolicy,
        limits: workspace.limits,
        externalWorkspaceRef: workspace.externalWorkspaceRef,
      }).catch(() => undefined);
    }
  }
  return markExecutionStatus({ organizationId: input.organizationId, executionJobId: job.id, status: "cancelled" });
}

export async function cleanupExecutionWorkspaces(input: { organizationId?: string } = {}) {
  const now = new Date();
  const rows = await db().select().from(executionWorkspaces).where(and(
    input.organizationId ? eq(executionWorkspaces.organizationId, input.organizationId) : undefined,
    isNotNull(executionWorkspaces.expiresAt),
    lte(executionWorkspaces.expiresAt, now),
    inArray(executionWorkspaces.status, ["ready", "failed", "terminated"]),
  )).limit(100);
  let cleaned = 0;
  for (const workspace of rows) {
    if (workspace.externalWorkspaceRef) {
      const runner = getExecutionRunner(workspace.runnerKind);
      await runner.cleanup({
        organizationId: workspace.organizationId,
        userId: workspace.userId ?? "system",
        executionJobId: "cleanup",
        workspaceId: workspace.id,
        template: workspace.template,
        networkPolicy: workspace.networkPolicy,
        limits: workspace.limits,
        externalWorkspaceRef: workspace.externalWorkspaceRef,
      }).catch(() => undefined);
    }
    await db().update(executionWorkspaces).set({ status: "terminated", updatedAt: now }).where(and(
      eq(executionWorkspaces.id, workspace.id), eq(executionWorkspaces.organizationId, workspace.organizationId),
    ));
    cleaned += 1;
  }
  return { cleaned };
}

export async function reconcileExecutionJobs() {
  const now = new Date();
  const stale = await db().select().from(executionJobs).where(and(
    inArray(executionJobs.status, ["running", "cancel_requested"]),
    isNotNull(executionJobs.leaseExpiresAt),
    lte(executionJobs.leaseExpiresAt, now),
  )).limit(100);
  for (const job of stale) {
    await db().update(executionJobs).set({
      status: job.cancelRequestedAt ? "cancelled" : "failed",
      errorCode: job.cancelRequestedAt ? null : "EXECUTION_LEASE_EXPIRED",
      errorReference: job.cancelRequestedAt ? null : crypto.randomUUID(),
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    }).where(and(eq(executionJobs.id, job.id), eq(executionJobs.organizationId, job.organizationId)));
    await appendExecutionEvent({
      organizationId: job.organizationId,
      executionJobId: job.id,
      type: "reconciled",
      payload: { status: job.cancelRequestedAt ? "cancelled" : "failed" },
    });
  }
  return { reconciled: stale.length };
}
