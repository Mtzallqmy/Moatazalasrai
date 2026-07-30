import { and, desc, eq, gt, max, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRunCheckpoints } from "@/db/agent-runtime-schema";
import { runs } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { runCheckpointTtlSeconds } from "@/lib/ai-sdk/limits";

const checkpointSchema = z.object({
  messages: z.array(z.unknown()),
  pendingApproval: z.object({
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    toolId: z.string().uuid(),
    arguments: z.record(z.string(), z.unknown()),
  }),
  agentId: z.string().uuid(),
  conversationId: z.string().uuid(),
  requestId: z.string().min(1),
  providerCredentialId: z.string().uuid(),
  model: z.string().min(1),
  candidateIndex: z.number().int().nonnegative(),
  emittedText: z.boolean(),
  toolExecuted: z.boolean(),
  sideEffectOccurred: z.boolean(),
  toolResultSaved: z.boolean(),
}).strict();

export type AgentRunCheckpointState = z.infer<typeof checkpointSchema>;

export async function saveRunCheckpoint(input: {
  organizationId: string;
  runId: string;
  state: AgentRunCheckpointState;
}) {
  const parsed = checkpointSchema.parse(input.state);
  const expiresAt = new Date(Date.now() + runCheckpointTtlSeconds() * 1000);
  return db().transaction(async (tx) => {
    const lock = await tx.execute(sql`
      SELECT "id" FROM "runs"
      WHERE "id" = ${input.runId} AND "organization_id" = ${input.organizationId}
      FOR UPDATE
    `);
    if (lock.length === 0) throw new ApiError(404, "RUN_NOT_FOUND", "عملية التشغيل غير موجودة.");
    const [latest] = await tx.select({ version: max(agentRunCheckpoints.version) })
      .from(agentRunCheckpoints)
      .where(and(
        eq(agentRunCheckpoints.organizationId, input.organizationId),
        eq(agentRunCheckpoints.runId, input.runId),
      ));
    const version = (latest?.version ?? 0) + 1;
    await tx.delete(agentRunCheckpoints).where(and(
      eq(agentRunCheckpoints.organizationId, input.organizationId),
      eq(agentRunCheckpoints.runId, input.runId),
    ));
    const [checkpoint] = await tx.insert(agentRunCheckpoints).values({
      organizationId: input.organizationId,
      runId: input.runId,
      version,
      encryptedState: encryptSecret(JSON.stringify(parsed)),
      expiresAt,
    }).returning();
    if (!checkpoint) throw new Error("RUN_CHECKPOINT_CREATE_FAILED");
    return checkpoint;
  });
}

export async function loadRunCheckpoint(organizationId: string, runId: string) {
  const now = new Date();
  const [checkpoint] = await db().select().from(agentRunCheckpoints).where(and(
    eq(agentRunCheckpoints.organizationId, organizationId),
    eq(agentRunCheckpoints.runId, runId),
    gt(agentRunCheckpoints.expiresAt, now),
  )).orderBy(desc(agentRunCheckpoints.version)).limit(1);
  if (!checkpoint) {
    await db().delete(agentRunCheckpoints).where(and(
      eq(agentRunCheckpoints.organizationId, organizationId),
      eq(agentRunCheckpoints.runId, runId),
    ));
    throw new ApiError(409, "RUN_CHECKPOINT_UNAVAILABLE", "نقطة استئناف التشغيل غير متاحة أو منتهية.");
  }
  try {
    return {
      checkpoint,
      state: checkpointSchema.parse(JSON.parse(decryptSecret(checkpoint.encryptedState))),
    };
  } catch {
    throw new ApiError(409, "RUN_CHECKPOINT_INVALID", "تعذر قراءة نقطة استئناف التشغيل بأمان.");
  }
}

export async function deleteRunCheckpoints(organizationId: string, runId: string) {
  await db().delete(agentRunCheckpoints).where(and(
    eq(agentRunCheckpoints.organizationId, organizationId),
    eq(agentRunCheckpoints.runId, runId),
  ));
}

export async function cleanupExpiredRunCheckpoints() {
  await db().delete(agentRunCheckpoints).where(sql`${agentRunCheckpoints.expiresAt} <= now()`);
}
