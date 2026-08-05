import { createHash } from "node:crypto";
import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import { agentRunSteps } from "@/db/agent-runtime-schema";
import { runs } from "@/db/schema";
import { ApiError } from "@/lib/http/api";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function nullableInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

export type RunStepType = "model" | "tool_call" | "tool_result" | "approval_requested" | "approval_response" | "fallback";

export async function createRunStepAllocator(organizationId: string, runId: string) {
  const first = await db().transaction(async (tx) => {
    const lock = await tx.execute(sql`
      SELECT "id" FROM "runs"
      WHERE "id" = ${runId} AND "organization_id" = ${organizationId}
      FOR UPDATE
    `);
    if (databaseRows(lock).length === 0) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
    const [current] = await tx.select({ value: max(agentRunSteps.stepNumber) })
      .from(agentRunSteps)
      .where(and(
        eq(agentRunSteps.organizationId, organizationId),
        eq(agentRunSteps.runId, runId),
      ));
    return (current?.value ?? 0) + 1;
  });
  let next = first;
  return () => {
    const value = next;
    next += 1;
    return value;
  };
}

export async function persistRunStep(input: {
  organizationId: string;
  runId: string;
  stepNumber: number;
  stepType: RunStepType;
  status: "running" | "completed" | "failed" | "waiting_approval";
  model?: string;
  providerCredentialId?: string;
  toolCallId?: string;
  toolId?: string;
  input?: unknown;
  output?: unknown;
  usage?: { inputTokens?: unknown; outputTokens?: unknown };
  durationMs?: number;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  const values = {
    organizationId: input.organizationId,
    runId: input.runId,
    stepNumber: input.stepNumber,
    stepType: input.stepType,
    status: input.status,
    model: input.model,
    providerCredentialId: input.providerCredentialId,
    toolCallId: input.toolCallId,
    toolId: input.toolId,
    inputDigest: input.input === undefined ? null : digest(input.input),
    outputDigest: input.output === undefined ? null : digest(input.output),
    inputTokens: nullableInteger(input.usage?.inputTokens),
    outputTokens: nullableInteger(input.usage?.outputTokens),
    durationMs: input.durationMs === undefined ? null : Math.max(0, Math.floor(input.durationMs)),
    errorCode: input.errorCode,
    metadata: input.metadata ?? {},
    completedAt: input.status === "running" ? null : now,
  };
  await db().insert(agentRunSteps).values(values).onConflictDoUpdate({
    target: [agentRunSteps.runId, agentRunSteps.stepNumber],
    set: {
      stepType: values.stepType,
      status: values.status,
      model: values.model,
      providerCredentialId: values.providerCredentialId,
      toolCallId: values.toolCallId,
      toolId: values.toolId,
      inputDigest: values.inputDigest,
      outputDigest: values.outputDigest,
      inputTokens: values.inputTokens,
      outputTokens: values.outputTokens,
      durationMs: values.durationMs,
      errorCode: values.errorCode,
      metadata: values.metadata,
      completedAt: values.completedAt,
    },
  });
}

export async function listRunSteps(organizationId: string, runId: string) {
  const [owned] = await db().select({ id: runs.id }).from(runs).where(and(
    eq(runs.id, runId),
    eq(runs.organizationId, organizationId),
  )).limit(1);
  if (!owned) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
  return db().select().from(agentRunSteps).where(and(
    eq(agentRunSteps.organizationId, organizationId),
    eq(agentRunSteps.runId, runId),
  )).orderBy(agentRunSteps.stepNumber);
}
