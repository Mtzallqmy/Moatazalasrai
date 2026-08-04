import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { ApiError, getRequestId, handleApiError } from "@/lib/http/api";
import { verifyAttachmentDownloadToken } from "@/lib/storage/attachment-signing";
import { readAttachmentContent } from "@/lib/storage/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const grant = verifyAttachmentDownloadToken(token);
    const [file] = await db().select().from(attachments).where(and(
      eq(attachments.id, grant.attachmentId),
      eq(attachments.organizationId, grant.organizationId),
      isNull(attachments.deletedAt),
    )).limit(1);
    if (!file) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
    if (file.processingStatus !== "ready") {
      throw new ApiError(423, "ATTACHMENT_QUARANTINED", "الملف غير متاح حتى يكتمل الفحص الأمني.");
    }
    const inline = grant.disposition === "inline"
      && (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf");
    const content = await readAttachmentContent(file);
    return new Response(new Uint8Array(Buffer.from(content)), {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.sizeBytes),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "cache-control": "private, no-store, max-age=0",
        "cdn-cache-control": "no-store",
        "cloudflare-cdn-cache-control": "no-store",
        "content-security-policy": "default-src 'none'; sandbox; img-src 'self' data:; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return handleApiError(error, requestId, "/api/attachments/download");
  }
}
