import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { storeAttachment } from "@/lib/storage/attachments";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "files:read");
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const [file] = await db().select().from(attachments).where(and(
        eq(attachments.id, id),
        eq(attachments.organizationId, principal.organizationId),
        principal.userId ? eq(attachments.uploadedByUserId, principal.userId) : undefined,
      )).limit(1);
      if (!file) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
      return new Response(new Uint8Array(file.content), {
        headers: {
          "content-type": file.mimeType,
          "content-length": String(file.sizeBytes),
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
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
      createdAt: attachments.createdAt,
    }).from(attachments).where(and(
      eq(attachments.organizationId, principal.organizationId),
      principal.userId ? eq(attachments.uploadedByUserId, principal.userId) : undefined,
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
    return apiSuccess({ file: created }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/files");
  }
}
