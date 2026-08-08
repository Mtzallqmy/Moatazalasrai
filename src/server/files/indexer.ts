import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachmentChunks, attachmentIntelligence } from "@/db/file-intelligence-schema";
import { chunkText } from "@/ai/rag/chunk";
import type { ProcessedFile } from "./processor";

function tokenEstimate(value: string) {
  return Math.ceil(value.length / 4) + 4;
}

export async function indexProcessedAttachment(input: {
  attachmentId: string;
  organizationId: string;
  conversationId?: string;
  processed: ProcessedFile;
}) {
  const chunks = input.processed.segments.flatMap((segment) =>
    chunkText(segment.text, { size: 1800, overlap: 180 }).map((chunk) => ({
      content: chunk.text,
      metadata: { ...segment.metadata, segmentStart: chunk.start, segmentEnd: chunk.end },
    })),
  ).slice(0, 300);
  const now = new Date();
  const usableStatus = input.processed.status === "ready" && chunks.length === 0
    ? "partially_ready"
    : input.processed.status;

  await db().transaction(async (tx) => {
    await tx.delete(attachmentChunks).where(eq(attachmentChunks.attachmentId, input.attachmentId));
    if (chunks.length) {
      await tx.insert(attachmentChunks).values(chunks.map((chunk, index) => ({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        attachmentId: input.attachmentId,
        chunkIndex: index,
        content: chunk.content,
        tokenEstimate: tokenEstimate(chunk.content),
        metadata: chunk.metadata,
      })));
    }
    await tx.insert(attachmentIntelligence).values({
      attachmentId: input.attachmentId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      status: usableStatus,
      detectedType: input.processed.detectedType,
      category: input.processed.category,
      extractedChars: input.processed.extractedText.length,
      chunkCount: chunks.length,
      warnings: input.processed.warnings,
      metadata: input.processed.metadata,
      extractedAt: input.processed.extractedText ? now : null,
      indexedAt: chunks.length ? now : null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: attachmentIntelligence.attachmentId,
      set: {
        conversationId: input.conversationId,
        status: usableStatus,
        detectedType: input.processed.detectedType,
        category: input.processed.category,
        extractedChars: input.processed.extractedText.length,
        chunkCount: chunks.length,
        warnings: input.processed.warnings,
        metadata: input.processed.metadata,
        extractedAt: input.processed.extractedText ? now : null,
        indexedAt: chunks.length ? now : null,
        updatedAt: now,
      },
    });
  });

  return { status: usableStatus, chunkCount: chunks.length, indexedAt: chunks.length ? now : null };
}
