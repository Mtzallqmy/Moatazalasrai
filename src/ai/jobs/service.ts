import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, backgroundJobs, knowledgeChunks, knowledgeDocuments } from "@/db/schema";
import { chunkText } from "@/ai/rag/chunk";
import { retryDelayMs } from "./backoff";

export const jobTypes = ["document.parse", "document.embed", "memory.compact", "evaluation.run", "integration.sync"] as const;
export type JobType = typeof jobTypes[number];

export async function enqueueJob(input: { organizationId: string; type: JobType; payload: Record<string, unknown>; maxAttempts?: number }) {
  const [job] = await db().insert(backgroundJobs).values({ ...input, maxAttempts: input.maxAttempts ?? 5 }).returning();
  return job;
}

export async function claimJobs(workerId: string, batchSize: number, lockTimeoutMs: number) {
  const rows = await db().execute(sql`
    WITH candidates AS (
      SELECT id FROM background_jobs
      WHERE status = 'queued' AND available_at <= now()
        AND (locked_at IS NULL OR locked_at < now() - (${lockTimeoutMs} * interval '1 millisecond'))
      ORDER BY available_at, created_at
      FOR UPDATE SKIP LOCKED LIMIT ${batchSize}
    )
    UPDATE background_jobs AS jobs SET
      status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = jobs.attempts + 1, updated_at = now()
    FROM candidates WHERE jobs.id = candidates.id
    RETURNING jobs.*
  `);
  return [...rows] as unknown as Array<{ id: string; organization_id: string; type: JobType; payload: Record<string, unknown>; attempts: number; max_attempts: number }>;
}

async function processDocument(job: { organization_id: string; payload: Record<string, unknown> }) {
  const documentId = String(job.payload.documentId ?? "");
  const [document] = await db().select({ id: knowledgeDocuments.id, attachmentId: knowledgeDocuments.attachmentId })
    .from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.organizationId, job.organization_id))).limit(1);
  if (!document) throw new Error("DOCUMENT_NOT_FOUND");
  const [attachment] = await db().select({ text: attachments.extractedText }).from(attachments).where(and(
    eq(attachments.id, document.attachmentId), eq(attachments.organizationId, job.organization_id),
  )).limit(1);
  if (!attachment?.text) throw new Error("DOCUMENT_TEXT_UNAVAILABLE");
  const chunks = chunkText(attachment.text);
  await db().transaction(async (tx) => {
    await tx.update(knowledgeDocuments).set({ status: "processing", updatedAt: new Date() }).where(eq(knowledgeDocuments.id, document.id));
    await tx.delete(knowledgeChunks).where(and(eq(knowledgeChunks.documentId, document.id), eq(knowledgeChunks.organizationId, job.organization_id)));
    if (chunks.length) await tx.insert(knowledgeChunks).values(chunks.map((chunk) => ({
      organizationId: job.organization_id, documentId: document.id, chunkIndex: chunk.index,
      content: chunk.text, tokenEstimate: Math.ceil(chunk.text.length / 4), metadata: { start: chunk.start, end: chunk.end },
    })));
    await tx.update(knowledgeDocuments).set({ status: "ready", errorCode: null, updatedAt: new Date() }).where(eq(knowledgeDocuments.id, document.id));
  });
  return { documentId, chunks: chunks.length };
}

export async function executeClaimedJob(job: Awaited<ReturnType<typeof claimJobs>>[number]) {
  try {
    let result: Record<string, unknown>;
    if (job.type === "document.parse") result = await processDocument(job);
    else result = { accepted: true };
    await db().update(backgroundJobs).set({
      status: "completed", result, completedAt: new Date(), lockedAt: null, lockedBy: null, updatedAt: new Date(),
    }).where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.organizationId, job.organization_id)));
  } catch (error) {
    const terminal = job.attempts >= job.max_attempts;
    await db().update(backgroundJobs).set({
      status: terminal ? "failed" : "queued",
      availableAt: new Date(Date.now() + retryDelayMs(job.attempts)),
      lastErrorCode: error instanceof Error ? error.message.slice(0, 100) : "JOB_FAILED",
      lockedAt: null, lockedBy: null, updatedAt: new Date(),
    }).where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.organizationId, job.organization_id)));
  }
}
