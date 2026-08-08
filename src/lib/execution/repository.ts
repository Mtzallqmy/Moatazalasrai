import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  executionArtifacts,
  executionEvents,
  executionJobs,
  executionLeases,
  executionSteps,
  executionUsage,
  executionWorkspaces,
} from "@/db/execution-schema";
import type { ExecutionStatus } from "@/lib/execution/contracts";
import { ExecutionError } from "@/lib/execution/errors";

export type ExecutionActor = {
  organizationId: string;
  userId: string;
  role: string;
};

type DatabaseClient = ReturnType<typeof db>;
export type ExecutionTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function enqueueExecutionTaskTx(tx: ExecutionTransaction, input: {
  task: "execution-provision" | "execution-run-step" | "execution-collect-artifacts" | "execution-cancel" | "execution-cleanup" | "execution-reconcile" | "execution-expire" | "operational-tool-execute";
  payload: Record<string, string>;
  queueName: "execution-provision" | "execution-run" | "execution-cleanup" | "execution-maintenance" | "operational-tools";
  jobKey: string;
  maxAttempts?: number;
  priority?: number;
  runAt?: Date;
}) {
  await tx.execute(sql`
    SELECT id
    FROM graphile_worker.add_job(
      identifier => ${input.task},
      payload => ${JSON.stringify(input.payload)}::json,
      queue_name => ${input.queueName},
      run_at => ${input.runAt ?? new Date()},
      max_attempts => ${input.maxAttempts ?? 3},
      job_key => ${input.jobKey},
      priority => ${input.priority ?? 0},
      job_key_mode => 'unsafe_dedupe'
    )
  `);
}

export async function getExecutionJob(input: {
  organizationId: string;
  jobId: string;
  userId?: string;
}) {
  const [row] = await db().select({
    job: executionJobs,
    workspace: executionWorkspaces,
    usage: executionUsage,
  }).from(executionJobs)
    .innerJoin(executionWorkspaces, eq(executionWorkspaces.id, executionJobs.workspaceId))
    .leftJoin(executionUsage, eq(executionUsage.jobId, executionJobs.id))
    .where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, input.organizationId),
      input.userId ? eq(executionJobs.userId, input.userId) : undefined,
    )).limit(1);
  if (!row) throw new ExecutionError("EXECUTION_NOT_FOUND", "عملية التنفيذ غير موجودة.");
  return row;
}

export async function getExecutionForActor(actor: ExecutionActor, jobId: string) {
  return getExecutionJob({
    organizationId: actor.organizationId,
    jobId,
    userId: actor.role === "member" ? actor.userId : undefined,
  });
}

export async function listExecutions(input: {
  actor: ExecutionActor;
  status?: ExecutionStatus;
  page: number;
  limit: number;
}) {
  const where = and(
    eq(executionJobs.organizationId, input.actor.organizationId),
    input.actor.role === "member" ? eq(executionJobs.userId, input.actor.userId) : undefined,
    input.status ? eq(executionJobs.status, input.status) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db().select({
      id: executionJobs.id,
      kind: executionJobs.kind,
      status: executionJobs.status,
      runnerKind: executionWorkspaces.runnerKind,
      userId: executionJobs.userId,
      priority: executionJobs.priority,
      attemptCount: executionJobs.attemptCount,
      maxAttempts: executionJobs.maxAttempts,
      errorCode: executionJobs.errorCode,
      errorReference: executionJobs.errorReference,
      createdAt: executionJobs.createdAt,
      startedAt: executionJobs.startedAt,
      completedAt: executionJobs.completedAt,
      updatedAt: executionJobs.updatedAt,
      stdoutBytes: executionUsage.stdoutBytes,
      stderrBytes: executionUsage.stderrBytes,
      artifactBytes: executionUsage.artifactBytes,
      memoryPeakBytes: executionUsage.memoryPeakBytes,
    }).from(executionJobs)
      .innerJoin(executionWorkspaces, eq(executionWorkspaces.id, executionJobs.workspaceId))
      .leftJoin(executionUsage, eq(executionUsage.jobId, executionJobs.id))
      .where(where)
      .orderBy(desc(executionJobs.createdAt), desc(executionJobs.id))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db().select({ value: count() }).from(executionJobs).where(where),
  ]);
  const total = totals[0]?.value ?? 0;
  return { rows, pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) } };
}

export async function listExecutionEvents(input: { organizationId: string; jobId: string; after: number; limit: number }) {
  return db().select().from(executionEvents).where(and(eq(executionEvents.jobId, input.jobId), sql`${executionEvents.sequence} > ${input.after}`)).orderBy(asc(executionEvents.sequence)).limit(input.limit);
}

export async function acquireExecutionLease(input: { organizationId: string; jobId: string; workerId: string; ttlSeconds: number }) {
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1_000);
  const result = await db().transaction(async (tx) => {
    const [job] = await tx.select({ id: executionJobs.id }).from(executionJobs).where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.organizationId, input.organizationId))).limit(1);
    if (!job) throw new ExecutionError("EXECUTION_NOT_FOUND", "عملية التنفيذ غير موجودة.");
    const [lease] = await tx.insert(executionLeases).values({ jobId: input.jobId, workerId: input.workerId, leaseTokenHash: hash, expiresAt }).onConflictDoUpdate({
      target: executionLeases.jobId,
      set: { workerId: input.workerId, leaseTokenHash: hash, acquiredAt: new Date(), heartbeatAt: new Date(), expiresAt },
      setWhere: sql`${executionLeases.expiresAt} < now() OR ${executionLeases.workerId} = ${input.workerId}`,
    }).returning();
    if (!lease) throw new ExecutionError("EXECUTION_LEASE_CONFLICT", "عملية التنفيذ مستخدمة حاليًا من عامل آخر.", true);
    return lease;
  });
  return { ...result, token };
}

export async function heartbeatExecutionLease(input: { jobId: string; token: string; ttlSeconds: number }) {
  const hash = tokenHash(input.token);
  const [lease] = await db().update(executionLeases).set({ heartbeatAt: new Date(), expiresAt: new Date(Date.now() + input.ttlSeconds * 1_000) }).where(and(eq(executionLeases.jobId, input.jobId), eq(executionLeases.leaseTokenHash, hash))).returning();
  if (!lease) throw new ExecutionError("EXECUTION_LEASE_LOST", "فقد العامل ملكية التنفيذ.", true);
  return lease;
}

export async function releaseExecutionLease(input: { jobId: string; token: string }) {
  await db().delete(executionLeases).where(and(eq(executionLeases.jobId, input.jobId), eq(executionLeases.leaseTokenHash, tokenHash(input.token))));
}

export async function updateExecutionUsage(input: {
  organizationId: string;
  userId: string;
  jobId: string;
  cpuMilliseconds?: number;
  memoryPeakBytes?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  networkBytes?: number;
  artifactBytes?: number;
}) {
  const patch = {
    ...(input.cpuMilliseconds !== undefined ? { cpuMilliseconds: input.cpuMilliseconds } : {}),
    ...(input.memoryPeakBytes !== undefined ? { memoryPeakBytes: input.memoryPeakBytes } : {}),
    ...(input.stdoutBytes !== undefined ? { stdoutBytes: input.stdoutBytes } : {}),
    ...(input.stderrBytes !== undefined ? { stderrBytes: input.stderrBytes } : {}),
    ...(input.networkBytes !== undefined ? { networkBytes: input.networkBytes } : {}),
    ...(input.artifactBytes !== undefined ? { artifactBytes: input.artifactBytes } : {}),
    updatedAt: new Date(),
  };
  await db().update(executionUsage).set(patch).where(and(eq(executionUsage.organizationId, input.organizationId), eq(executionUsage.userId, input.userId), eq(executionUsage.jobId, input.jobId)));
}

export async function findReconciliationCandidates(graceSeconds: number) {
  const threshold = new Date(Date.now() - graceSeconds * 1_000);
  return db().select().from(executionJobs).where(and(
    inArray(executionJobs.status, ["queued", "provisioning", "ready", "running", "cancel_requested", "cancelling", "orphaned"]),
    sql`${executionJobs.updatedAt} < ${threshold}`,
  )).orderBy(asc(executionJobs.updatedAt)).limit(100);
}
