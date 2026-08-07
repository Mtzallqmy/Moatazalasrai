import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  executionEvents,
  executionJobs,
  executionSteps,
  executionUsage,
  executionWorkspaces,
} from "@/db/execution-schema";
import { auditLogs } from "@/db/schema";
import type { ExecutionCreateInput } from "@/lib/execution/contracts";
import { defaultNetworkPolicy } from "@/lib/execution/network-policy-service";
import { platformExecutionLimits } from "@/lib/execution/quota-service";
import { enqueueExecutionTaskTx, type ExecutionActor } from "@/lib/execution/repository";
import { assertExecutionKernelEnabled, selectedRunnerKind } from "@/lib/execution/runner-registry";
import { diagnosticCommand, diagnosticExpectedArtifact } from "@/lib/execution/validation";

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export async function createDiagnosticExecution(input: {
  actor: ExecutionActor;
  requestId: string;
  body: ExecutionCreateInput;
}) {
  assertExecutionKernelEnabled();
  const limits = platformExecutionLimits();
  const networkPolicy = defaultNetworkPolicy();
  const runnerKind = selectedRunnerKind();
  const command = diagnosticCommand(input.body.input.scenario, limits);
  const requiredArtifact = diagnosticExpectedArtifact(input.body.input.scenario);
  const lockKey = `${input.actor.organizationId}:${input.body.idempotencyKey}`;

  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [existing] = await tx.select().from(executionJobs).where(and(
      eq(executionJobs.organizationId, input.actor.organizationId),
      eq(executionJobs.idempotencyKey, input.body.idempotencyKey),
    )).limit(1);
    if (existing) return { job: existing, duplicate: true };

    const workspaceId = randomUUID();
    const jobId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + integer("EXECUTION_WORKSPACE_TTL_SECONDS", 1_800, 60, 86_400) * 1_000);
    const [workspace] = await tx.insert(executionWorkspaces).values({
      id: workspaceId,
      organizationId: input.actor.organizationId,
      userId: input.actor.userId,
      runnerKind,
      templateId: "moataz-code",
      state: "provisioning",
      networkPolicy,
      limits,
      metadata: { requestId: input.requestId, diagnosticScenario: input.body.input.scenario },
      expiresAt,
    }).returning();
    if (!workspace) throw new Error("EXECUTION_WORKSPACE_CREATE_FAILED");

    const [job] = await tx.insert(executionJobs).values({
      id: jobId,
      organizationId: input.actor.organizationId,
      userId: input.actor.userId,
      workspaceId,
      kind: input.body.kind,
      status: "queued",
      idempotencyKey: input.body.idempotencyKey,
      requestedInput: { scenario: input.body.input.scenario },
      normalizedInput: {
        scenario: input.body.input.scenario,
        command: { argv: command.argv, cwd: command.cwd, timeoutMs: command.timeoutMs },
        networkPolicy,
        limits,
      },
      resultSummary: {
        executionVerified: false,
        requiredArtifactCount: requiredArtifact ? 1 : 0,
        requiredArtifact,
      },
      maxAttempts: 3,
      expiresAt,
    }).returning();
    if (!job) throw new Error("EXECUTION_JOB_CREATE_FAILED");

    await tx.insert(executionSteps).values({
      jobId,
      sequence: 1,
      kind: "diagnostic.command",
      status: "queued",
      commandSpec: { argv: command.argv, cwd: command.cwd, timeoutMs: command.timeoutMs },
      inputSummary: { scenario: input.body.input.scenario },
    });
    await tx.insert(executionUsage).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.userId,
      jobId,
    });
    await tx.insert(executionEvents).values([
      {
        jobId,
        sequence: 1,
        eventType: "job.created",
        source: "api",
        payload: { kind: input.body.kind, runnerKind, requestId: input.requestId },
      },
      {
        jobId,
        sequence: 2,
        eventType: "job.queued",
        source: "api",
        payload: { queue: "execution-provision" },
      },
    ]);
    await enqueueExecutionTaskTx(tx, {
      task: "execution-provision",
      payload: { organizationId: input.actor.organizationId, jobId },
      queueName: "execution-provision",
      jobKey: `execution:provision:${jobId}`,
      maxAttempts: 3,
    });
    await tx.insert(auditLogs).values({
      organizationId: input.actor.organizationId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "execution.created",
      resourceType: "execution_job",
      resourceId: jobId,
      metadata: {
        requestId: input.requestId,
        kind: input.body.kind,
        scenario: input.body.input.scenario,
        runnerKind,
        networkMode: networkPolicy.mode,
      },
    });
    return { job, duplicate: false };
  });
}
