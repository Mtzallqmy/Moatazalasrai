import { and, count, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attachments, auditLogs } from "@/db/schema";
import { can, requireSession } from "@/lib/auth/authorization";
import { requireConversationAccess } from "@/lib/chat/access";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { paginationSchema, uuidSchema } from "@/lib/http/contracts";
import { deleteAttachmentContent, readAttachmentContent, storeAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/storage/attachments";

export const runtime = "nodejs";

const fileActionSchema = z.object({ id: uuidSchema, action: z.enum(["archive", "restore"]) }).strict();
const fileDeleteSchema = z.object({ id: uuidSchema }).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("files:read");
    const ownFilesOnly = session.role === "member";
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const [file] = await db().select().from(attachments).where(and(
        eq(attachments.id, id),
        eq(attachments.organizationId, session.organizationId),
        isNull(attachments.deletedAt),
      )).limit(1);
      if (!file) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
      if (session.role === "member" && file.uploadedByUserId !== session.userId) {
        if (!file.conversationId) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
        await requireConversationAccess({
          organizationId: session.organizationId,
          conversationId: file.conversationId,
          userId: session.userId,
          role: session.role,
          access: "read",
          includeArchived: true,
        });
      }
      const content = await readAttachmentContent(file);
      const preview = url.searchParams.get("preview") === "true"
        && (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf");
      return new Response(new Uint8Array(Buffer.from(content)), {
        headers: {
          "content-type": file.mimeType,
          "content-length": String(file.sizeBytes),
          "content-disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "x-request-id": requestId,
        },
      });
    }
    const query = paginationSchema.parse(Object.fromEntries(url.searchParams));
    const search = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
    const archived = url.searchParams.get("archived") === "true";
    const where = and(
      eq(attachments.organizationId, session.organizationId),
      ownFilesOnly ? eq(attachments.uploadedByUserId, session.userId) : undefined,
      isNull(attachments.deletedAt),
      archived ? isNotNull(attachments.archivedAt) : isNull(attachments.archivedAt),
      search ? ilike(attachments.filename, `%${search}%`) : undefined,
    );
    const [rows, totals] = await Promise.all([
      db().select({
        id: attachments.id,
        conversationId: attachments.conversationId,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        source: attachments.source,
        detectedType: attachments.detectedType,
        processingStatus: attachments.processingStatus,
        processingErrorCode: attachments.processingErrorCode,
        archivedAt: attachments.archivedAt,
        createdAt: attachments.createdAt,
        updatedAt: attachments.updatedAt,
      }).from(attachments).where(where)
        .orderBy(desc(attachments.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db().select({ value: count() }).from(attachments).where(where),
    ]);
    const total = totals[0]?.value ?? 0;
    return apiSuccess(rows, requestId, 200, {
      pagination: { ...query, total, pages: Math.ceil(total / query.limit) },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/files");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    if (!can(session.role, "files:manage")) throw new ApiError(403, "FORBIDDEN", "لا تملك صلاحية أرشفة الملفات.");
    const body = await parseJson(request, fileActionSchema, 4 * 1024);
    const fileId = body.id;
    const [updated] = await db().transaction(async (tx) => {
      const [file] = await tx.update(attachments).set({
        archivedAt: body.action === "archive" ? new Date() : null,
        deletedAt: body.action === "restore" ? null : undefined,
        updatedAt: new Date(),
      }).where(and(eq(attachments.id, fileId), eq(attachments.organizationId, session.organizationId)))
        .returning({ id: attachments.id, filename: attachments.filename });
      if (!file) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: `attachment.${body.action}`,
        resourceType: "attachment",
        resourceId: file.id,
        metadata: { requestId, filename: file.filename },
      });
      return [file];
    });
    return apiSuccess(updated, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/files");
  }
}

export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    const body = await parseJson(request, fileDeleteSchema, 4 * 1024);
    const fileId = body.id;
    const [target] = await db().select().from(attachments).where(and(
      eq(attachments.id, fileId),
      eq(attachments.organizationId, session.organizationId),
      can(session.role, "files:manage") ? undefined : eq(attachments.uploadedByUserId, session.userId),
      isNull(attachments.deletedAt),
    )).limit(1);
    if (!target) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
    await deleteAttachmentContent(target);
    const [deleted] = await db().transaction(async (tx) => {
      const [file] = await tx.update(attachments).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(attachments.id, fileId),
          eq(attachments.organizationId, session.organizationId),
          can(session.role, "files:manage") ? undefined : eq(attachments.uploadedByUserId, session.userId),
          isNull(attachments.deletedAt),
        ))
        .returning({ id: attachments.id, filename: attachments.filename });
      if (!file) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "attachment.deleted",
        resourceType: "attachment",
        resourceId: file.id,
        metadata: { requestId, filename: file.filename },
      });
      return [file];
    });
    return apiSuccess({ deleted: true, id: deleted.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/files");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("files:upload");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "حجم الطلب أكبر من الحد.");
    const form = await request.formData();
    const file = form.get("file");
    const conversationIdValue = String(form.get("conversationId") ?? "").trim();
    const conversationId = conversationIdValue ? uuidSchema.parse(conversationIdValue) : "";
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "اختر ملفًا.");
    if (conversationId) {
      await requireConversationAccess({
        organizationId: session.organizationId,
        conversationId,
        userId: session.userId,
        role: session.role,
        access: "write",
      });
    }
    const created = await storeAttachment({
      organizationId: session.organizationId,
      conversationId: conversationId || undefined,
      uploadedByUserId: session.userId,
      source: "web",
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      content: Buffer.from(await file.arrayBuffer()),
    });
    return apiSuccess(created, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/files");
  }
}
