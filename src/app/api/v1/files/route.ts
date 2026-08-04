import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { createAttachmentDownloadUrl } from "@/lib/storage/attachment-signing";
import { storeAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/storage/attachments";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "files:read");
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const [file] = await db().select({
        id: attachments.id,
        processingStatus: attachments.processingStatus,
      }).from(attachments).where(and(
        eq(attachments.id, id),
        eq(attachments.organizationId, principal.organizationId),
        principal.userId ? eq(attachments.uploadedByUserId, principal.userId) : undefined,
        isNull(attachments.deletedAt),
      )).limit(1);
      if (!file) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
      if (file.processingStatus !== "ready") {
        throw new ApiError(423, "ATTACHMENT_QUARANTINED", "الملف غير متاح حتى يكتمل الفحص الأمني.");
      }
      const signed = createAttachmentDownloadUrl({
        origin: new URL(request.url).origin,
        attachmentId: file.id,
        organizationId: principal.organizationId,
      });
      return new Response(null, {
        status: 307,
        headers: {
          location: signed.url,
          "cache-control": "private, no-store",
          "x-request-id": requestId,
        },
      });
    }
    const rows = await db().select({
      id: attachments.id,
      conversationId: attachments.conversationId,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      sha256: attachments.sha256,
      source: attachments.source,
      processingStatus: attachments.processingStatus,
      createdAt: attachments.createdAt,
    }).from(attachments).where(and(
      eq(attachments.organizationId, principal.organizationId),
      principal.userId ? eq(attachments.uploadedByUserId, principal.userId) : undefined,
      isNull(attachments.deletedAt),
    ))
      .orderBy(desc(attachments.createdAt)).limit(100);
    return apiSuccess({ files: rows }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/files");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "files:write");
    await enforceRateLimit({
      scope: "api.files.upload",
      key: `${principal.organizationId}:${principal.principalId}`,
      limit: 30,
      windowMs: 60_000,
    });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "حجم الطلب أكبر من الحد.");
    const form = await request.formData();
    const file = form.get("file");
    const conversationId = String(form.get("conversationId") ?? "").trim();
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "اختر ملفًا.");
    const created = await storeAttachment({
      organizationId: principal.organizationId,
      conversationId: conversationId || undefined,
      source: "api",
      uploadedByUserId: principal.userId ?? undefined,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      content: Buffer.from(await file.arrayBuffer()),
    });
    return apiSuccess({ file: created }, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/files");
  }
}
