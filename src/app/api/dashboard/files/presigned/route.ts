import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { requireConversationAccess } from "@/lib/chat/access";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { cleanFilename, MAX_ATTACHMENT_BYTES, validateDeclaredMime } from "@/lib/storage/attachments";
import { objectStorage } from "@/lib/storage/object-storage";
import { enqueueAttachmentProcess } from "@/worker/queue";

const reserveSchema = z.object({
  conversationId: z.string().uuid().optional(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();
const finalizeSchema = z.object({ attachmentId: z.string().uuid() }).strict();

function signedTtl() {
  const value = Number(process.env.R2_SIGNED_URL_TTL_SECONDS ?? 300);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 60), 900) : 300;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("files:read");
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "FILE_ID_INVALID", "معرّف الملف غير صالح.");
    const [file] = await db().select({
      id: attachments.id, filename: attachments.filename, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes,
      sha256: attachments.sha256, processingStatus: attachments.processingStatus, processingErrorCode: attachments.processingErrorCode,
    }).from(attachments).where(and(eq(attachments.id, id), eq(attachments.organizationId, session.organizationId), eq(attachments.uploadedByUserId, session.userId), isNull(attachments.deletedAt))).limit(1);
    if (!file) throw new ApiError(404, "FILE_NOT_FOUND", "الملف غير موجود.");
    return apiSuccess({ ...file, intelligenceStatus: file.processingStatus, warnings: file.processingErrorCode ? [file.processingErrorCode] : [] }, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/dashboard/files/presigned"); }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    if (process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase() !== "r2") {
      throw new ApiError(409, "DIRECT_UPLOAD_UNAVAILABLE", "الرفع المباشر متاح عند تفعيل R2 فقط.");
    }
    const session = await requireSession("files:upload");
    const body = await parseJson(request, reserveSchema, 8 * 1024);
    if (body.conversationId) await requireConversationAccess({ organizationId: session.organizationId, conversationId: body.conversationId, userId: session.userId, role: session.role, access: "write" });
    const mimeType = validateDeclaredMime(body.filename, body.mimeType);
    const id = crypto.randomUUID();
    const objectKey = `${session.organizationId}/${id}`;
    const [created] = await db().insert(attachments).values({
      id,
      organizationId: session.organizationId,
      conversationId: body.conversationId,
      uploadedByUserId: session.userId,
      source: "web",
      filename: cleanFilename(body.filename),
      mimeType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256.toLowerCase(),
      storageDriver: "r2",
      objectKey,
      processingStatus: "pending",
    }).returning({ id: attachments.id, filename: attachments.filename, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes, sha256: attachments.sha256 });
    if (!created) throw new Error("ATTACHMENT_RESERVE_FAILED");
    try {
      const uploadUrl = await objectStorage("r2").createSignedUploadUrl({ key: objectKey, contentType: mimeType, sizeBytes: body.sizeBytes, sha256: body.sha256.toLowerCase(), expiresInSeconds: signedTtl() });
      return apiSuccess({ attachment: created, uploadUrl, expiresIn: signedTtl(), requiredHeaders: { "content-type": mimeType, "x-amz-meta-sha256": body.sha256.toLowerCase() } }, requestId, 201);
    } catch (error) {
      await db().delete(attachments).where(and(eq(attachments.id, id), eq(attachments.organizationId, session.organizationId)));
      throw error;
    }
  } catch (error) { return handleApiError(error, requestId, "/api/dashboard/files/presigned"); }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("files:upload");
    const body = await parseJson(request, finalizeSchema, 4 * 1024);
    const [file] = await db().select().from(attachments).where(and(
      eq(attachments.id, body.attachmentId),
      eq(attachments.organizationId, session.organizationId),
      eq(attachments.uploadedByUserId, session.userId),
      eq(attachments.storageDriver, "r2"),
      isNull(attachments.deletedAt),
    )).limit(1);
    if (!file?.objectKey) throw new ApiError(404, "FILE_NOT_FOUND", "حجز الملف غير موجود.");
    const uploaded = await objectStorage("r2").head(file.objectKey);
    if (uploaded.sizeBytes !== file.sizeBytes || uploaded.sha256?.toLowerCase() !== file.sha256.toLowerCase() || uploaded.contentType !== file.mimeType) {
      await objectStorage("r2").delete(file.objectKey).catch(() => undefined);
      await db().update(attachments).set({ processingStatus: "failed", processingErrorCode: "FILE_UPLOAD_MISMATCH", updatedAt: new Date() })
        .where(and(eq(attachments.id, file.id), eq(attachments.organizationId, session.organizationId)));
      throw new ApiError(422, "FILE_UPLOAD_MISMATCH", "الملف المرفوع لا يطابق الحجز الآمن.");
    }
    await enqueueAttachmentProcess({ organizationId: session.organizationId, attachmentId: file.id });
    return apiSuccess({ id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256, processingStatus: "pending", intelligenceStatus: "pending", warnings: [] }, requestId, 202);
  } catch (error) { return handleApiError(error, requestId, "/api/dashboard/files/presigned"); }
}
