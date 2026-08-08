import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { executionArtifacts, executionJobs } from "@/db/execution-schema";
import { toolRunInputs, toolRuns } from "@/db/tool-run-schema";
import { auditLogs } from "@/db/schema";
import type { CreateToolRunInput, ToolManifest } from "./contracts";

export class ToolRunError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ToolRunError";
  }
}

function hasStructuredResult(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function verificationPassed(value: Record<string, unknown>): boolean {
  return value.passed === true;
}

export async function createToolRunForExecution(input: {
  organizationId: string;
  userId: string;
  manifest: ToolManifest;
  executionJobId: string;
  body: CreateToolRunInput;
  requestId: string;
}) {
  return db().transaction(async (tx) => {
    const [job] = await tx.select().from(executionJobs).where(and(
      eq(executionJobs.id, input.executionJobId),
      eq(executionJobs.organizationId, input.organizationId),
      eq(executionJobs.userId, input.userId),
    )).limit(1);
    if (!job) throw new ToolRunError("EXECUTION_NOT_FOUND", "Execution job not found for this tenant and user.");

    const [existing] = await tx.select().from(toolRuns).where(and(
      eq(toolRuns.organizationId, input.organizationId),
      eq(toolRuns.executionJobId, input.executionJobId),
    )).limit(1);
    if (existing) return { run: existing, duplicate: true };

    const [run] = await tx.insert(toolRuns).values({
      organizationId: input.organizationId,
      userId: input.userId,
      toolId: input.manifest.id,
      toolVersion: input.manifest.version,
      executionJobId: input.executionJobId,
      status: job.status === "queued" ? "queued" : "validating",
      title: input.body.title,
      inputSummary: { count: input.body.inputs.length, kinds: input.body.inputs.map((item) => item.kind) },
      config: input.body.config,
      verification: { passed: false },
    }).returning();
    if (!run) throw new ToolRunError("TOOL_RUN_CREATE_FAILED", "Unable to create Tool Run.");

    if (input.body.inputs.length > 0) {
      await tx.insert(toolRunInputs).values(input.body.inputs.map((item) => ({
        organizationId: input.organizationId,
        toolRunId: run.id,
        inputKind: item.kind,
        artifactId: item.artifactId,
        value: item.value as Record<string, unknown> | string | number | boolean | unknown[] | undefined,
        sha256: item.sha256,
      })));
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "tool_run.created",
      resourceType: "tool_run",
      resourceId: run.id,
      metadata: { requestId: input.requestId, toolId: input.manifest.id, executionJobId: input.executionJobId },
    });
    return { run, duplicate: false };
  });
}

export async function verifyAndCompleteToolRun(input: {
  organizationId: string;
  toolRunId: string;
  resultSummary: Record<string, unknown>;
  verification: Record<string, unknown>;
}) {
  return db().transaction(async (tx) => {
    const [run] = await tx.select().from(toolRuns).where(and(
      eq(toolRuns.id, input.toolRunId),
      eq(toolRuns.organizationId, input.organizationId),
    )).limit(1);
    if (!run) throw new ToolRunError("TOOL_RUN_NOT_FOUND", "Tool Run not found.");

    const [job] = await tx.select().from(executionJobs).where(and(
      eq(executionJobs.id, run.executionJobId),
      eq(executionJobs.organizationId, input.organizationId),
    )).limit(1);
    if (!job || job.status !== "completed") {
      throw new ToolRunError("EXECUTION_NOT_COMPLETED", "Tool Run cannot complete before its Execution Job completes.");
    }

    const artifactCountResult = await tx.select({ count: sql<number>`count(*)::int` }).from(executionArtifacts).where(and(
      eq(executionArtifacts.organizationId, input.organizationId),
      eq(executionArtifacts.jobId, run.executionJobId),
    ));
    const artifactCount = artifactCountResult[0]?.count ?? 0;
    if (!hasStructuredResult(input.resultSummary) && artifactCount === 0) {
      throw new ToolRunError("EMPTY_SUCCESS", "A completed Tool Run must have a structured result or an artifact.");
    }
    if (!verificationPassed(input.verification)) {
      throw new ToolRunError("VERIFICATION_FAILED", "Tool verification must pass before completion.");
    }

    const [updated] = await tx.update(toolRuns).set({
      status: "completed",
      resultSummary: input.resultSummary,
      verification: input.verification,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(toolRuns.id, run.id), eq(toolRuns.organizationId, input.organizationId))).returning();
    return updated;
  });
}
