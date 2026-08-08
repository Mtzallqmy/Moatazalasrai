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
  task: "execution-provision" | "execution-run-step" | "execution-collect-artifacts" | "execution-cancel" | "execution-cleanup" | "execution-reconcile" | "execution-expire";
  payload: Record<string, string>;
  queueName: "execution-provision" | "execution-run" | "execution-cleanup" | "execution-maintenance";
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
  return { rows, pagination: { page: input.page, limit: input.limit, total, pages: Math.ceil(total / input.limit) } };
}

export async function executionDetails(actor: ExecutionActor, jobId: string) {
  const scoped = await getExecutionForActor(actor, jobId);
  const [steps, artifacts, recentEvents] = await Promise.all([
    db().select({
      id: executionSteps.id,
      sequence: executionSteps.sequence,
      kind: executionSteps.kind,
      status: executionSteps.status,
      outputSummary: executionSteps.outputSummary,
      exitCode: executionSteps.exitCode,
      signal: executionSteps.signal,
      errorCode: executionSteps.errorCode,
      startedAt: executionSteps.startedAt,
      completedAt: executionSteps.completedAt,
    }).from(executionSteps).where(eq(executionSteps.jobId, jobId)).orderBy(asc(executionSteps.sequence)),
    db().select({
      id: executionArtifacts.id,
      filename: executionArtifacts.filename,
      mediaType: executionArtifacts.mediaType,
      sizeBytes: executionArtifacts.sizeBytes,
      sha256: executionArtifacts.sha256,
      kind: executionArtifacts.kind,
      metadata: executionArtifacts.metadata,
      createdAt: executionArtifacts.createdAt,
    }).from(executionArtifacts).where(and(
      eq(executionArtifacts.organizationId, actor.organizationId),
      eq(executionArtifacts.jobId, jobId),
    )).orderBy(asc(executionArtifacts.createdAt)),
    db().select({
      sequence: executionEvents.sequence,
      type: executionEvents.eventType,
      source: executionEvents.source,
      level: executionEvents.level,
      payload: executionEvents.payload,
      createdAt: executionEvents.createdAt,
    }).from(executionEvents).where(eq(executionEvents.jobId, jobId)).orderBy(desc(executionEvents.sequence)).limit(100),
  ]);
  return { ...scoped, steps, artifacts, recentEvents: recentEvents.reverse() };
}

export async function acquireExecutionLease(input: {
  organizationId: string;
  jobId: string;
  workerId: string;
  ttlSeconds: number;
}) {
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1_000);
  return db().transaction(async (tx) => {
    const [job] = await tx.select({ id: executionJobs.id }).from(executionJobs).where(and(
      eq(executionJobs.id, input.jobId),
      eq(executionJobs.organizationId, input.organizationId),
    )).for("update").limit(1);
    if (!job) throw new ExecutionError("EXECUTION_NOT_FOUND", "عملية التنفيذ غير موجودة.");
    const result = await tx.execute<{ job_id: string }>(sql`
      INSERT INTO execution_leases (job_id, worker_id, lease_token_hash, acquired_at, heartbeat_at, expires_at)
      VALUES (${input.jobId}::uuid, ${input.workerId}, ${hash}, now(), now(), ${expiresAt})
      ON CONFLICT (job_id) DO UPDATE SET
        worker_id = EXCLUDED.worker_id,
        lease_token_hash = EXCLUDED.lease_token_hash,
        acquired_at = now(),
        heartbeat_at = now(),
        expires_at = EXCLUDED.expires_at
      WHERE execution_leases.expires_at <= now()
      RETURNING job_id
    `);
    if (!result.rows[0]) throw new ExecutionError("EXECUTION_LEASE_UNAVAILABLE", "عملية التنفيذ مملوكة لعامل نشط.", true);
    return { token, expiresAt };
  });
}

export async function heartbeatExecutionLease(input: {
  jobId: string;
  token: string;
  ttlSeconds: number;
}) {
  const [lease] = await db().update(executionLeases).set({
    heartbeatAt: new Date(),
    expiresAt: new Date(Date.now() + input.ttlSeconds * 1_000),
  }).where(and(
    eq(executionLeases.jobId, input.jobId),
    eq(executionLeases.leaseTokenHash, tokenHash(input.token)),
  )).returning();
  if (!lease) throw new ExecutionError("EXECUTION_LEASE_UNAVAILABLE", "انتهت صلاحية lease التنفيذ.", true);
  return lease;
}

export async function releaseExecutionLease(input: { jobId: string; token: string }) {
  await db().delete(executionLeases).where(and(
    eq(executionLeases.jobId, input.jobId),
    eq(executionLeases.leaseTokenHash, tokenHash(input.token)),
  ));
}

export async function updateExecutionUsage(input: {
  organizationId: string;
  userId: string;
  jobId: string;
  stdoutBytes?: number;
  stderrBytes?: number;
  artifactBytes?: number;
  memoryPeakBytes?: number;
  diskPeakBytes?: number;
  cpuMilliseconds?: number;
}) {
  const values = {
    organizationId: input.organizationId,
    userId: input.userId,
    jobId: input.jobId,
    stdoutBytes: input.stdoutBytes ?? 0,
    stderrBytes: input.stderrBytes ?? 0,
    artifactBytes: input.artifactBytes ?? 0,
    memoryPeakBytes: input.memoryPeakBytes ?? 0,
    diskPeakBytes: input.diskPeakBytes ?? 0,
    cpuMilliseconds: input.cpuMilliseconds ?? 0,
    updatedAt: new Date(),
  };
  const [usage] = await db().insert(executionUsage).values(values).onConflictDoUpdate({
    target: executionUsage.jobId,
    set: {
      stdoutBytes: values.stdoutBytes,
      stderrBytes: values.stderrBytes,
      artifactBytes: values.artifactBytes,
      memoryPeakBytes: values.memoryPeakBytes,
      diskPeakBytes: values.diskPeakBytes,
      cpuMilliseconds: values.cpuMilliseconds,
      updatedAt: values.updatedAt,
    },
  }).returning();
  return usage;
}

export async function findReconciliationCandidates(graceSeconds: number) {
  const stale = new Date(Date.now() - graceSeconds * 1_000);
  return db().select({
    id: executionJobs.id,
    organizationId: executionJobs.organizationId,
    status: executionJobs.status,
    workspaceId: executionJobs.workspaceId,
    updatedAt: executionJobs.updatedAt,
  }).from(executionJobs).where(and(
    inArray(executionJobs.status, ["provisioning", "ready", "running", "cancel_requested", "cancelling", "orphaned"]),
    sql`${executionJobs.updatedAt} <= ${stale}`,
  )).orderBy(asc(executionJobs.updatedAt)).limit(100);
}
