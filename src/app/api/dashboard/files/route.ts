import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";
import { storeAttachment } from "@/lib/storage/attachments";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("files:read");
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const [file] = await db().select().from(attachments).where(and(
        eq(attachments.id, id),
        eq(attachments.organizationId, session.organizationId),
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
    }).from(attachments).where(eq(attachments.organizationId, session.organizationId))
      .orderBy(desc(attachments.createdAt)).limit(100);
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/files");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("files:manage");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 11 * 1024 * 1024) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "حجم الطلب أكبر من الحد.");
    const form = await request.formData();
    const file = form.get("file");
    const conversationId = String(form.get("conversationId") ?? "").trim();
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "اختر ملفًا.");
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
