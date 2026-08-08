import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  executionJobs,
  executionSteps,
  executionWorkspaces,
} from "@/db/execution-schema";
import { auditLogs } from "@/db/schema";
import { withTelemetry } from "@/ai/observability/telemetry";
import {
  commandRequestSchema,
  executionLimitsSchema,
  networkPolicySchema,
  type ExecutionStatus,
} from "@/lib/execution/contracts";
import { storeExecutionArtifact } from "@/lib/execution/artifact-service";
import { revokeExecutionCredentialGrants } from "@/lib/execution/credential-grant-service";
import { appendExecutionEvent, appendOutputEvent } from "@/lib/execution/event-service";
import { asExecutionError, ExecutionError } from "@/lib/execution/errors";
import {
  acquireExecutionLease,
  enqueueExecutionTaskTx,
  findReconciliationCandidates,
  getExecutionJob,
  heartbeatExecutionLease,
  releaseExecutionLease,
  updateExecutionUsage,
} from "@/lib/execution/repository";
import { getExecutionRunner, requireHealthyExecutionRunner } from "@/lib/execution/runner-registry";
import { TERMINAL_EXECUTION_STATUSES, transitionExecutionStatus } from "@/lib/execution/states";
import { diagnosticExpectedArtifact, diagnosticExpectedOutput } from "@/lib/execution/validation";

function leaseTtlSeconds() {
  const value = Number(process.env.EXECUTION_LEASE_TTL_SECONDS ?? 60);
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, 30), 300) : 60;
}

function reconcileGraceSeconds() {
  const value = Number(process.env.EXECUTION_RECONCILE_GRACE_SECONDS ?? 120);
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, 60), 1_800) : 120;
}

async function enqueue(input: Parameters<typeof enqueueExecutionTaskTx>[1]) {
  await db().transaction((tx) => enqueueExecutionTaskTx(tx, input));
}

async function currentStatus(organizationId: string, jobId: string) {
  const [job] = await db().select({ status: executionJobs.status }).from(executionJobs).where(and(
    eq(executionJobs.id, jobId),
    eq(executionJobs.organizationId, organizationId),
  )).limit(1);
  return job?.status ?? null;
}

async function updateStep(input: {
  jobId: string;
  status: string;
  outputSummary?: Record<string, unknown>;
  exitCode?: number | null;
  signal?: string | null;
  errorCode?: string | null;
  startedAt?: Date;
  completedAt?: Date;
}) {
  await db().update(executionSteps).set({
    status: input.status,
    ...(input.outputSummary ? { outputSummary: input.outputSummary } : {}),
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    updatedAt: new Date(),
  }).where(and(eq(executionSteps.jobId, input.jobId), eq(executionSteps.sequence, 1)));
}

async function enqueueCleanup(organizationId: string, jobId: string) {
  await enqueue({
    task: "execution-cleanup",
    payload: { organizationId, jobId },
    queueName: "execution-cleanup",
    jobKey: `execution:cleanup:${jobId}`,
    maxAttempts: 10,
  });
}

async function failExecution(input: {
  organizationId: string;
  jobId: string;
  expected: ExecutionStatus | ExecutionStatus[];
  error: unknown;
  source: string;
}) {
  const failure = asExecutionError(input.error);
  const expected = Array.isArray(input.expected) ? input.expected : [input.expected];
  const status = await currentStatus(input.organizationId, input.jobId);
  if (status && !TERMINAL_EXECUTION_STATUSES.has(status)) {
    await transitionExecutionStatus({
      organizationId: input.organizationId,
      jobId: input.jobId,
      expectedStatus: expected.includes(status) ? status : expected,
      nextStatus: failure.code === "EXECUTION_RUNNER_TIMEOUT" ? "timed_out" : "failed",
      source: input.source,
      level: "error",
      payload: { errorCode: failure.code, retryable: failure.retryable },
      patch: { errorCode: failure.code, errorReference: randomUUID() },
    }).catch(() => undefined);
  }
  await updateStep({
    jobId: input.jobId,
    status: "failed",
    errorCode: failure.code,
    completedAt: new Date(),
  }).catch(() => undefined);
  await enqueueCleanup(input.organizationId, input.jobId);
  return failure;
}

export async function provisionExecution(input: {
  organizationId: string;
  jobId: string;
  workerId: string;
}) {
  return withTelemetry({ operation: "execution.provision", executionId: input.jobId, runner: "selected" }, async () => {
    const lease = await acquireExecutionLease({ ...input, ttlSeconds: leaseTtlSeconds() });
    try {
      let record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
      if (TERMINAL_EXECUTION_STATUSES.has(record.job.status)) return record.job;
      if (record.job.status === "cancel_requested" || record.job.status === "cancelling") {
        await enqueue({
          task: "execution-cancel",
          payload: { organizationId: input.organizationId, jobId: input.jobId },
          queueName: "execution-cleanup",
          jobKey: `execution:cancel:${input.jobId}`,
          maxAttempts: 5,
        });
        return record.job;
      }
      if (record.job.status === "queued") {
        await transitionExecutionStatus({
          organizationId: input.organizationId,
          jobId: input.jobId,
          expectedStatus: "queued",
          nextStatus: "provisioning",
          source: "worker",
          patch: { attemptCount: record.job.attemptCount + 1 },
        });
        record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
      }
      if (record.job.status !== "provisioning") return record.job;

      const limits = executionLimitsSchema.parse(record.workspace.limits);
      const networkPolicy = networkPolicySchema.parse(record.workspace.networkPolicy);
      const { runner, health } = await requireHealthyExecutionRunner({ organizationId: input.organizationId, limits });
      const workspace = record.workspace.externalWorkspaceId
        ? { externalWorkspaceId: record.workspace.externalWorkspaceId, state: record.workspace.state }
        : await runner.createWorkspace({
            executionId: record.workspace.id,
            organizationId: input.organizationId,
            templateId: record.workspace.templateId,
            limits,
            networkPolicy,
          });
      const now = new Date();
      await db().update(executionWorkspaces).set({
        externalWorkspaceId: workspace.externalWorkspaceId,
        state: "ready",
        provisionedAt: record.workspace.provisionedAt ?? now,
        lastHeartbeatAt: now,
        metadata: { ...(record.workspace.metadata ?? {}), runnerHealth: health.checkedAt },
        updatedAt: now,
      }).where(and(
        eq(executionWorkspaces.id, record.workspace.id),
        eq(executionWorkspaces.organizationId, input.organizationId),
      ));
      await transitionExecutionStatus({
        organizationId: input.organizationId,
        jobId: input.jobId,
        expectedStatus: "provisioning",
        nextStatus: "ready",
        source: "worker",
        payload: { runnerKind: runner.kind },
      });
      await enqueue({
        task: "execution-run-step",
        payload: { organizationId: input.organizationId, jobId: input.jobId },
        queueName: "execution-run",
        jobKey: `execution:run:${input.jobId}:1`,
        maxAttempts: record.job.maxAttempts,
      });
      return (await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId })).job;
    } catch (error) {
      const failure = asExecutionError(error);
      const record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId }).catch(() => null);
      if (failure.retryable && record && record.job.attemptCount < record.job.maxAttempts) {
        await appendExecutionEvent({
          organizationId: input.organizationId,
          jobId: input.jobId,
          type: "job.failed",
          source: "worker",
          level: "warn",
          payload: { errorCode: failure.code, retryScheduled: true, attempt: record.job.attemptCount },
        }).catch(() => undefined);
        throw failure;
      }
      await failExecution({
        organizationId: input.organizationId,
        jobId: input.jobId,
        expected: ["queued", "provisioning", "orphaned"],
        error: failure,
        source: "worker",
      });
      return null;
    } finally {
      await releaseExecutionLease({ jobId: input.jobId, token: lease.token }).catch(() => undefined);
    }
  });
}

export async function runExecutionStep(input: {
  organizationId: string;
  jobId: string;
  workerId: string;
}) {
  return withTelemetry({ operation: "execution.run_step", executionId: input.jobId }, async () => {
    const lease = await acquireExecutionLease({ ...input, ttlSeconds: leaseTtlSeconds() });
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      let record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
      if (TERMINAL_EXECUTION_STATUSES.has(record.job.status)) return record.job;
      if (record.job.status === "cancel_requested" || record.job.status === "cancelling") {
        await enqueue({
          task: "execution-cancel",
          payload: { organizationId: input.organizationId, jobId: input.jobId },
          queueName: "execution-cleanup",
          jobKey: `execution:cancel:${input.jobId}`,
          maxAttempts: 5,
        });
        return record.job;
      }
      if (record.job.status === "ready" || record.job.status === "orphaned") {
        await transitionExecutionStatus({
          organizationId: input.organizationId,
          jobId: input.jobId,
          expectedStatus: record.job.status,
          nextStatus: "running",
          source: "worker",
        });
        record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
      }
      if (record.job.status !== "running" || !record.workspace.externalWorkspaceId) {
        throw new ExecutionError("EXECUTION_WORKSPACE_NOT_READY", "مساحة التنفيذ ليست جاهزة.", true);
      }
      const limits = executionLimitsSchema.parse(record.workspace.limits);
      const commandRecord = record.job.normalizedInput && typeof record.job.normalizedInput === "object"
        ? (record.job.normalizedInput as Record<string, unknown>).command
        : null;
      const command = commandRequestSchema.parse(commandRecord);
      const scenario = String((record.job.normalizedInput as Record<string, unknown>).scenario ?? "success") as "success" | "failure" | "timeout" | "secrets";
      const runner = getExecutionRunner({ organizationId: input.organizationId, limits });
      await updateStep({ jobId: input.jobId, status: "running", startedAt: new Date(), errorCode: null });
      await appendExecutionEvent({
        organizationId: input.organizationId,
        jobId: input.jobId,
        type: "step.started",
        source: "worker",
        payload: { sequence: 1, kind: "diagnostic.command" },
      });

      let stdout = "";
      let stderr = "";
      heartbeat = setInterval(() => {
        void heartbeatExecutionLease({ jobId: input.jobId, token: lease.token, ttlSeconds: leaseTtlSeconds() });
      }, Math.max(5_000, Math.floor(leaseTtlSeconds() * 500)));
      heartbeat.unref();
      const result = await runner.executeCommand(record.workspace.externalWorkspaceId, command, {
        onStdout: async (chunk) => {
          if (Buffer.byteLength(stdout, "utf8") < limits.maxOutputBytes) stdout += Buffer.from(chunk).toString("utf8");
          await appendOutputEvent({ organizationId: input.organizationId, jobId: input.jobId, stream: "stdout", chunk });
        },
        onStderr: async (chunk) => {
          if (Buffer.byteLength(stderr, "utf8") < limits.maxOutputBytes) stderr += Buffer.from(chunk).toString("utf8");
          await appendOutputEvent({ organizationId: input.organizationId, jobId: input.jobId, stream: "stderr", chunk });
        },
        onState: async (state) => {
          if (state !== "running") {
            await appendExecutionEvent({
              organizationId: input.organizationId,
              jobId: input.jobId,
              type: "process.terminated",
              source: "runner",
              payload: { state },
            });
          }
        },
      });
      await updateExecutionUsage({
        organizationId: input.organizationId,
        userId: record.job.userId,
        jobId: input.jobId,
        stdoutBytes: result.stdoutBytes,
        stderrBytes: result.stderrBytes,
        cpuMilliseconds: Math.max(0, new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()),
      });

      const freshStatus = await currentStatus(input.organizationId, input.jobId);
      if (freshStatus === "cancel_requested" || freshStatus === "cancelling" || result.signal === "SIGTERM" && result.exitCode === null && !result.timedOut) {
        await enqueue({
          task: "execution-cancel",
          payload: { organizationId: input.organizationId, jobId: input.jobId },
          queueName: "execution-cleanup",
          jobKey: `execution:cancel:${input.jobId}`,
          maxAttempts: 5,
        });
        return null;
      }
      if (result.timedOut) {
        await updateStep({ jobId: input.jobId, status: "failed", exitCode: result.exitCode, signal: result.signal, errorCode: "EXECUTION_RUNNER_TIMEOUT", completedAt: new Date() });
        await transitionExecutionStatus({
          organizationId: input.organizationId,
          jobId: input.jobId,
          expectedStatus: "running",
          nextStatus: "timed_out",
          source: "runner",
          level: "error",
          payload: { exitCode: result.exitCode, signal: result.signal },
          patch: { errorCode: "EXECUTION_RUNNER_TIMEOUT", errorReference: randomUUID() },
        });
        await enqueueCleanup(input.organizationId, input.jobId);
        return null;
      }
      if (result.exitCode !== 0) {
        throw new ExecutionError("EXECUTION_RUNNER_PROTOCOL_ERROR", "انتهى البرنامج التشخيصي برمز خروج غير صفري.", false, {
          exitCode: result.exitCode,
          stderrBytes: result.stderrBytes,
        });
      }
      const expected = diagnosticExpectedOutput(scenario);
      if (expected && stdout.trim() !== expected) {
        throw new ExecutionError("EXECUTION_RUNNER_PROTOCOL_ERROR", "لم ينتج التنفيذ القيمة التشخيصية المتوقعة.", false, {
          expected,
          stdoutBytes: result.stdoutBytes,
        });
      }
      await updateStep({
        jobId: input.jobId,
        status: "completed",
        outputSummary: {
          exitCode: result.exitCode,
          signal: result.signal,
          stdoutBytes: result.stdoutBytes,
          stderrBytes: result.stderrBytes,
          stdoutVerified: expected ? stdout.trim() === expected : true,
        },
        exitCode: result.exitCode,
        signal: result.signal,
        errorCode: null,
        completedAt: new Date(result.completedAt),
      });
      await appendExecutionEvent({
        organizationId: input.organizationId,
        jobId: input.jobId,
        type: "step.completed",
        source: "runner",
        payload: { sequence: 1, exitCode: result.exitCode, stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes },
      });
      await db().update(executionJobs).set({
        resultSummary: {
          ...(record.job.resultSummary ?? {}),
          processVerified: true,
          stdoutVerified: expected ? stdout.trim() === expected : true,
          stderrObserved: Boolean(stderr),
        },
        updatedAt: new Date(),
      }).where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.organizationId, input.organizationId)));
      await enqueue({
        task: "execution-collect-artifacts",
        payload: { organizationId: input.organizationId, jobId: input.jobId },
        queueName: "execution-run",
        jobKey: `execution:artifacts:${input.jobId}`,
        maxAttempts: 3,
      });
      return result;
    } catch (error) {
      const failure = asExecutionError(error);
      const record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId }).catch(() => null);
      if (failure.retryable && record && record.job.attemptCount < record.job.maxAttempts && record.job.status === "running") {
        await transitionExecutionStatus({
          organizationId: input.organizationId,
          jobId: input.jobId,
          expectedStatus: "running",
          nextStatus: "orphaned",
          source: "worker",
          level: "warn",
          payload: { errorCode: failure.code, retryScheduled: true },
          patch: { attemptCount: record.job.attemptCount + 1 },
        }).catch(() => undefined);
        throw failure;
      }
      await failExecution({
        organizationId: input.organizationId,
        jobId: input.jobId,
        expected: ["ready", "running", "orphaned"],
        error: failure,
        source: "worker",
      });
      return null;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await releaseExecutionLease({ jobId: input.jobId, token: lease.token }).catch(() => undefined);
    }
  });
}

async function collectBytes(content: AsyncIterable<Uint8Array>, maximum: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of content) {
    size += chunk.byteLength;
    if (size > maximum) throw new ExecutionError("EXECUTION_ARTIFACT_LIMIT", "تجاوز Artifact حد الملف الواحد.");
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function collectExecutionArtifacts(input: {
  organizationId: string;
  jobId: string;
  workerId: string;
}) {
  const lease = await acquireExecutionLease({ ...input, ttlSeconds: leaseTtlSeconds() });
  try {
    const record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
    if (TERMINAL_EXECUTION_STATUSES.has(record.job.status)) return record.job;
    if (record.job.status !== "running" || !record.workspace.externalWorkspaceId) {
      throw new ExecutionError("EXECUTION_WORKSPACE_NOT_READY", "لا يمكن جمع النتائج قبل اكتمال خطوة التنفيذ.", true);
    }
    const limits = executionLimitsSchema.parse(record.workspace.limits);
    const scenario = String((record.job.normalizedInput as Record<string, unknown>).scenario ?? "success") as "success" | "failure" | "timeout" | "secrets";
    const expectedPath = diagnosticExpectedArtifact(scenario);
    let artifactCount = 0;
    if (expectedPath) {
      const runner = getExecutionRunner({ organizationId: input.organizationId, limits });
      const files = await runner.listFiles(record.workspace.externalWorkspaceId, ".");
      const file = files.find((item) => item.path === expectedPath && item.type === "file");
      if (!file) throw new ExecutionError("EXECUTION_ARTIFACT_INVALID", "لم ينشئ التنفيذ Artifact التشخيصي المطلوب.");
      if (file.sizeBytes > limits.maxSingleFileBytes) throw new ExecutionError("EXECUTION_ARTIFACT_LIMIT", "Artifact أكبر من حد الملف الواحد.");
      await appendExecutionEvent({
        organizationId: input.organizationId,
        jobId: input.jobId,
        type: "artifact.discovered",
        source: "runner",
        payload: { path: expectedPath, sizeBytes: file.sizeBytes },
      });
      const body = await collectBytes(await runner.downloadFile(record.workspace.externalWorkspaceId, expectedPath), limits.maxSingleFileBytes);
      const expected = diagnosticExpectedOutput(scenario);
      if (expected && Buffer.from(body).toString("utf8").trim() !== expected) {
        throw new ExecutionError("EXECUTION_ARTIFACT_INVALID", "محتوى Artifact لا يطابق ناتج التنفيذ المثبت.");
      }
      await storeExecutionArtifact({
        organizationId: input.organizationId,
        userId: record.job.userId,
        jobId: input.jobId,
        stepId: (await db().select({ id: executionSteps.id }).from(executionSteps).where(and(eq(executionSteps.jobId, input.jobId), eq(executionSteps.sequence, 1))).limit(1))[0]?.id,
        sourcePath: expectedPath,
        filename: expectedPath,
        kind: "test-result",
        content: (async function* stream() { yield body; })(),
        limits,
        metadata: { scenario, verified: true },
      });
      artifactCount = 1;
    }
    await db().update(executionJobs).set({
      resultSummary: {
        ...(record.job.resultSummary ?? {}),
        executionVerified: true,
        processVerified: true,
        artifactCount,
        requiredArtifactCount: expectedPath ? 1 : 0,
      },
      updatedAt: new Date(),
    }).where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.organizationId, input.organizationId)));
    await enqueueCleanup(input.organizationId, input.jobId);
    return { artifactCount };
  } catch (error) {
    await failExecution({
      organizationId: input.organizationId,
      jobId: input.jobId,
      expected: ["running", "orphaned"],
      error,
      source: "worker",
    });
    return null;
  } finally {
    await releaseExecutionLease({ jobId: input.jobId, token: lease.token }).catch(() => undefined);
  }
}

export async function cancelExecution(input: {
  organizationId: string;
  jobId: string;
  workerId: string;
}) {
  const lease = await acquireExecutionLease({ ...input, ttlSeconds: leaseTtlSeconds() });
  try {
    let record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
    if (TERMINAL_EXECUTION_STATUSES.has(record.job.status)) {
      await enqueueCleanup(input.organizationId, input.jobId);
      return record.job;
    }
    if (record.job.status === "cancel_requested") {
      await transitionExecutionStatus({
        organizationId: input.organizationId,
        jobId: input.jobId,
        expectedStatus: "cancel_requested",
        nextStatus: "cancelling",
        source: "worker",
      });
      record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
    }
    if (record.workspace.externalWorkspaceId) {
      const runner = getExecutionRunner({
        organizationId: input.organizationId,
        limits: executionLimitsSchema.parse(record.workspace.limits),
      });
      await runner.terminateProcess(record.workspace.externalWorkspaceId, record.workspace.externalWorkspaceId).catch((error) => {
        throw new ExecutionError("EXECUTION_RUNNER_CANCEL_FAILED", "لم يؤكد المشغل إيقاف العملية.", true, {
          errorName: error instanceof Error ? error.name : "UNKNOWN",
        });
      });
    }
    if (record.job.status === "cancelling") {
      await transitionExecutionStatus({
        organizationId: input.organizationId,
        jobId: input.jobId,
        expectedStatus: "cancelling",
        nextStatus: "cancelled",
        source: "worker",
      });
    }
    await updateStep({ jobId: input.jobId, status: "cancelled", errorCode: "EXECUTION_CANCELLED", completedAt: new Date() });
    await enqueueCleanup(input.organizationId, input.jobId);
    return (await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId })).job;
  } finally {
    await releaseExecutionLease({ jobId: input.jobId, token: lease.token }).catch(() => undefined);
  }
}

export async function cleanupExecution(input: {
  organizationId: string;
  jobId: string;
  workerId: string;
}) {
  const lease = await acquireExecutionLease({ ...input, ttlSeconds: leaseTtlSeconds() });
  try {
    const record = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
    if (record.workspace.externalWorkspaceId && record.workspace.state !== "stopped") {
      const runner = getExecutionRunner({
        organizationId: input.organizationId,
        limits: executionLimitsSchema.parse(record.workspace.limits),
      });
      await runner.destroyWorkspace(record.workspace.externalWorkspaceId);
      await db().update(executionWorkspaces).set({
        state: "stopped",
        destroyedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(executionWorkspaces.id, record.workspace.id),
        eq(executionWorkspaces.organizationId, input.organizationId),
      ));
      await appendExecutionEvent({
        organizationId: input.organizationId,
        jobId: input.jobId,
        type: "workspace.destroyed",
        source: "worker",
        payload: { runnerKind: record.workspace.runnerKind },
      });
    }
    await revokeExecutionCredentialGrants({ organizationId: input.organizationId, jobId: input.jobId });
    const fresh = await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId });
    if (fresh.job.status === "cancel_requested" || fresh.job.status === "cancelling") {
      await transitionExecutionStatus({
        organizationId: input.organizationId,
        jobId: input.jobId,
        expectedStatus: fresh.job.status,
        nextStatus: "cancelled",
        source: "worker",
      });
    } else if (fresh.job.status === "running") {
      await transitionExecutionStatus({
        organizationId: input.organizationId,
        jobId: input.jobId,
        expectedStatus: "running",
        nextStatus: "completed",
        source: "worker",
      });
    }
    await db().insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "system",
      action: "execution.cleaned",
      resourceType: "execution_job",
      resourceId: input.jobId,
      metadata: { runnerKind: record.workspace.runnerKind },
    });
    return (await getExecutionJob({ organizationId: input.organizationId, jobId: input.jobId })).job;
  } finally {
    await releaseExecutionLease({ jobId: input.jobId, token: lease.token }).catch(() => undefined);
  }
}

export async function reconcileExecutions(workerId: string) {
  const candidates = await findReconciliationCandidates(reconcileGraceSeconds());
  for (const candidate of candidates) {
    if (candidate.status === "cancel_requested" || candidate.status === "cancelling") {
      await enqueue({
        task: "execution-cancel",
        payload: { organizationId: candidate.organizationId, jobId: candidate.id },
        queueName: "execution-cleanup",
        jobKey: `execution:cancel:${candidate.id}`,
        maxAttempts: 5,
      });
      continue;
    }
    if (candidate.status === "queued" || candidate.status === "provisioning") {
      await enqueue({
        task: "execution-provision",
        payload: { organizationId: candidate.organizationId, jobId: candidate.id },
        queueName: "execution-provision",
        jobKey: `execution:provision:${candidate.id}`,
        maxAttempts: 3,
      });
      continue;
    }
    if (candidate.status === "ready" || candidate.status === "running" || candidate.status === "orphaned") {
      if (candidate.status === "running") {
        await transitionExecutionStatus({
          organizationId: candidate.organizationId,
          jobId: candidate.id,
          expectedStatus: "running",
          nextStatus: "orphaned",
          source: "reconciler",
          level: "warn",
          payload: { workerId, reason: "stale_heartbeat" },
        }).catch(() => undefined);
      }
      await enqueue({
        task: "execution-run-step",
        payload: { organizationId: candidate.organizationId, jobId: candidate.id },
        queueName: "execution-run",
        jobKey: `execution:run:${candidate.id}:1`,
        maxAttempts: 3,
      });
    }
  }
  return { scanned: candidates.length };
}

export async function expireExecutions() {
  const rows = await db().select({
    id: executionJobs.id,
    organizationId: executionJobs.organizationId,
    status: executionJobs.status,
  }).from(executionJobs).where(and(
    lte(executionJobs.expiresAt, new Date()),
    inArray(executionJobs.status, ["queued", "provisioning", "ready", "running", "waiting_for_input", "waiting_for_approval", "orphaned"]),
  )).limit(100);
  for (const row of rows) {
    await transitionExecutionStatus({
      organizationId: row.organizationId,
      jobId: row.id,
      expectedStatus: row.status,
      nextStatus: "timed_out",
      source: "expiry",
      level: "error",
      payload: { reason: "execution_expired" },
      patch: { errorCode: "EXECUTION_RUNNER_TIMEOUT", errorReference: randomUUID() },
    }).catch(() => undefined);
    await enqueueCleanup(row.organizationId, row.id);
  }
  return { expired: rows.length };
}
