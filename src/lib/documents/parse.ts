import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, knowledgeChunks, knowledgeDocuments } from "@/db/schema";
import { chunkText } from "@/ai/rag/chunk";
import { ApiError } from "@/lib/http/api";
import { withTelemetry } from "@/ai/observability/telemetry";

function documentErrorCode(error: unknown) {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message)) return error.message;
  return "DOCUMENT_PARSE_FAILED";
}

async function markDocumentFailed(organizationId: string, documentId: string, error: unknown) {
  await db().update(knowledgeDocuments).set({
    status: "failed",
    errorCode: documentErrorCode(error),
    updatedAt: new Date(),
  }).where(and(
    eq(knowledgeDocuments.id, documentId),
    eq(knowledgeDocuments.organizationId, organizationId),
  ));
}

export async function parseKnowledgeDocument(input: {
  organizationId: string;
  documentId: string;
  abortSignal?: AbortSignal;
}) {
  return withTelemetry({
    operation: "document.parse",
    organizationId: input.organizationId,
    documentId: input.documentId,
  }, async () => {
    if (input.abortSignal?.aborted) throw new ApiError(499, "JOB_CANCELLED", "تم إلغاء معالجة الوثيقة.");
    const [document] = await db().select({
      id: knowledgeDocuments.id,
      attachmentId: knowledgeDocuments.attachmentId,
      status: knowledgeDocuments.status,
    }).from(knowledgeDocuments).where(and(
      eq(knowledgeDocuments.id, input.documentId),
      eq(knowledgeDocuments.organizationId, input.organizationId),
    )).limit(1);
    if (!document || document.status === "deleted") {
      throw new ApiError(404, "DOCUMENT_NOT_FOUND", "الوثيقة غير موجودة أو محذوفة.");
    }

    try {
      const [attachment] = await db().select({
        text: attachments.extractedText,
        processingStatus: attachments.processingStatus,
      }).from(attachments).where(and(
        eq(attachments.id, document.attachmentId),
        eq(attachments.organizationId, input.organizationId),
        isNull(attachments.deletedAt),
      )).limit(1);
      if (!attachment || attachment.processingStatus !== "ready" || !attachment.text?.trim()) {
        throw new ApiError(422, "DOCUMENT_TEXT_UNAVAILABLE", "نص الوثيقة غير متاح للمعالجة.");
      }

      await db().update(knowledgeDocuments).set({
        status: "processing",
        errorCode: null,
        updatedAt: new Date(),
      }).where(and(
        eq(knowledgeDocuments.id, document.id),
        eq(knowledgeDocuments.organizationId, input.organizationId),
      ));

      const chunks = chunkText(attachment.text);
      if (input.abortSignal?.aborted) throw new ApiError(499, "JOB_CANCELLED", "تم إلغاء معالجة الوثيقة.");
      if (chunks.length === 0) throw new ApiError(422, "DOCUMENT_EMPTY", "لم ينتج عن الوثيقة أي مقطع قابل للفهرسة.");

      await db().transaction(async (tx) => {
        await tx.delete(knowledgeChunks).where(and(
          eq(knowledgeChunks.documentId, document.id),
          eq(knowledgeChunks.organizationId, input.organizationId),
        ));
        await tx.insert(knowledgeChunks).values(chunks.map((chunk) => ({
          organizationId: input.organizationId,
          documentId: document.id,
          chunkIndex: chunk.index,
          content: chunk.text,
          tokenEstimate: Math.ceil(chunk.text.length / 4),
          metadata: { start: chunk.start, end: chunk.end },
        })));
        await tx.update(knowledgeDocuments).set({
          status: "ready",
          errorCode: null,
          updatedAt: new Date(),
        }).where(and(
          eq(knowledgeDocuments.id, document.id),
          eq(knowledgeDocuments.organizationId, input.organizationId),
        ));
      });
      return { documentId: document.id, chunks: chunks.length };
    } catch (error) {
      await markDocumentFailed(input.organizationId, document.id, error);
      throw error;
    }
  });
}
