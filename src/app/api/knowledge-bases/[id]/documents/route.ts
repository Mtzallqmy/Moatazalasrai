import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attachments, auditLogs, backgroundJobs, knowledgeBases, knowledgeDocuments } from "@/db/schema";
import { aiFeatureEnabled } from "@/ai/config";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
const schema = z.object({ attachmentId: uuidSchema, title: z.string().trim().min(1).max(200).optional() }).strict();
async function owned(organizationId: string, id: string) {
  const [row] = await db().select({ id: knowledgeBases.id }).from(knowledgeBases).where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.organizationId, organizationId))).limit(1);
  if (!row) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "قاعدة المعرفة غير موجودة.");
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة.");
    const session = await requireSession("files:read"), { id } = await context.params; await owned(session.organizationId, id);
    const rows = await db().select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, session.organizationId), eq(knowledgeDocuments.knowledgeBaseId, id))).orderBy(desc(knowledgeDocuments.createdAt));
    return apiSuccess(rows, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/knowledge-bases/:id/documents"); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة.");
    assertSameOrigin(request); const session = await requireSession("files:manage"), { id } = await context.params; await owned(session.organizationId, id);
    const body = await parseJson(request, schema, 4096);
    const [file] = await db().select().from(attachments).where(and(eq(attachments.id, body.attachmentId), eq(attachments.organizationId, session.organizationId), isNull(attachments.deletedAt))).limit(1);
    if (!file || file.processingStatus !== "ready") throw new ApiError(422, "ATTACHMENT_NOT_READY", "الملف غير موجود أو غير جاهز.");
    const document = await db().transaction(async (tx) => {
      const [row] = await tx.insert(knowledgeDocuments).values({ organizationId: session.organizationId, knowledgeBaseId: id,
        attachmentId: file.id, title: body.title ?? file.filename, mimeType: file.mimeType, byteSize: file.sizeBytes, checksumSha256: file.sha256 }).returning();
      await tx.insert(backgroundJobs).values({ organizationId: session.organizationId, type: "document.parse", payload: { documentId: row!.id } });
      return row;
    });
    return apiSuccess(document, requestId, 201);
  } catch (error) { return handleApiError(error, requestId, "/api/knowledge-bases/:id/documents"); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("RAG")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة قواعد المعرفة غير مفعلة.");
    assertSameOrigin(request); const session = await requireSession("files:manage"), { id } = await context.params; await owned(session.organizationId, id);
    const body = await parseJson(request, z.object({ documentId: uuidSchema }).strict(), 4096);
    const deleted = await db().transaction(async (tx) => {
      const [row] = await tx.delete(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, body.documentId),
        eq(knowledgeDocuments.knowledgeBaseId, id), eq(knowledgeDocuments.organizationId, session.organizationId))).returning({ id: knowledgeDocuments.id });
      if (!row) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "الوثيقة غير موجودة.");
      await tx.insert(auditLogs).values({ organizationId: session.organizationId, actorType: "user", actorId: session.userId,
        action: "knowledge_document.deleted", resourceType: "knowledge_document", resourceId: row.id, metadata: { requestId } });
      return row;
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/knowledge-bases/:id/documents"); }
}
