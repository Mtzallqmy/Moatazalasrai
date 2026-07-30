import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attachments, auditLogs, knowledgeBases, knowledgeDocuments } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
import { enqueueDocumentParse } from "@/worker/queue";

const schema = z.object({ attachmentId: uuidSchema, title: z.string().trim().min(1).max(200).optional() }).strict();

async function owned(organizationId: string, id: string) {
  const [row] = await db().select({ id: knowledgeBases.id }).from(knowledgeBases).where(and(
    eq(knowledgeBases.id, id),
    eq(knowledgeBases.organizationId, organizationId),
  )).limit(1);
  if (!row) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "قاعدة المعرفة غير موجودة.");
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة.");
    const session = await requireSession("files:read");
    const { id } = await context.params;
    await owned(session.organizationId, id);
    const rows = await db().select().from(knowledgeDocuments).where(and(
      eq(knowledgeDocuments.organizationId, session.organizationId),
      eq(knowledgeDocuments.knowledgeBaseId, id),
    )).orderBy(desc(knowledgeDocuments.createdAt));
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/knowledge-bases/:id/documents");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة.");
    assertSameOrigin(request);
    const session = await requireSession("files:manage");
    const { id } = await context.params;
    await owned(session.organizationId, id);
    const body = await parseJson(request, schema, 4096);
    const [file] = await db().select().from(attachments).where(and(
      eq(attachments.id, body.attachmentId),
      eq(attachments.organizationId, session.organizationId),
      isNull(attachments.deletedAt),
    )).limit(1);
    if (!file || file.processingStatus !== "ready") {
      throw new ApiError(422, "ATTACHMENT_NOT_READY", "الملف غير موجود أو غير جاهز.");
    }

    const document = await db().transaction(async (tx) => {
      const [row] = await tx.insert(knowledgeDocuments).values({
        organizationId: session.organizationId,
        knowledgeBaseId: id,
        attachmentId: file.id,
        title: body.title ?? file.filename,
        mimeType: file.mimeType,
        byteSize: file.sizeBytes,
        checksumSha256: file.sha256,
        status: "uploaded",
      }).returning();
      if (!row) throw new Error("KNOWLEDGE_DOCUMENT_CREATE_FAILED");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "knowledge_document.created",
        resourceType: "knowledge_document",
        resourceId: row.id,
        metadata: { knowledgeBaseId: id, attachmentId: file.id, requestId },
      });
      return row;
    });

    try {
      const queued = await enqueueDocumentParse({
        organizationId: session.organizationId,
        documentId: document.id,
      });
      return apiSuccess({ ...document, workerJobId: queued.jobId }, requestId, 202);
    } catch (error) {
      await db().update(knowledgeDocuments).set({
        status: "failed",
        errorCode: "DOCUMENT_QUEUE_FAILED",
        updatedAt: new Date(),
      }).where(and(
        eq(knowledgeDocuments.id, document.id),
        eq(knowledgeDocuments.organizationId, session.organizationId),
      ));
      throw new ApiError(503, "DOCUMENT_QUEUE_FAILED", "تعذر إضافة الوثيقة إلى قائمة المعالجة.", {
        cause: error instanceof Error ? error.name : "UNKNOWN",
      });
    }
  } catch (error) {
    return handleApiError(error, requestId, "/api/knowledge-bases/:id/documents");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة.");
    assertSameOrigin(request);
    const session = await requireSession("files:manage");
    const { id } = await context.params;
    await owned(session.organizationId, id);
    const body = await parseJson(request, z.object({ documentId: uuidSchema }).strict(), 4096);
    const deleted = await db().transaction(async (tx) => {
      const [row] = await tx.delete(knowledgeDocuments).where(and(
        eq(knowledgeDocuments.id, body.documentId),
        eq(knowledgeDocuments.knowledgeBaseId, id),
        eq(knowledgeDocuments.organizationId, session.organizationId),
      )).returning({ id: knowledgeDocuments.id });
      if (!row) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "الوثيقة غير موجودة.");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "knowledge_document.deleted",
        resourceType: "knowledge_document",
        resourceId: row.id,
        metadata: { requestId },
      });
      return row;
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/knowledge-bases/:id/documents");
  }
}
