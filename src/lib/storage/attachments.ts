import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversations } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { objectStorage } from "@/lib/storage/object-storage";
import { enqueueAttachmentScan } from "@/worker/queue";

const configuredMaxBytes = Number(process.env.MAX_ATTACHMENT_BYTES ?? 10 * 1024 * 1024);
export const MAX_ATTACHMENT_BYTES = Number.isFinite(configuredMaxBytes)
  ? Math.min(Math.max(Math.floor(configuredMaxBytes), 1024), 25 * 1024 * 1024)
  : 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/octet-stream",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
]);

const MIME_FAMILIES: Record<string, Set<string>> = {
  ".jpg": new Set(["image/jpeg"]),
  ".jpeg": new Set(["image/jpeg"]),
  ".png": new Set(["image/png"]),
  ".webp": new Set(["image/webp"]),
  ".gif": new Set(["image/gif"]),
  ".pdf": new Set(["application/pdf"]),
  ".docx": new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  ".xlsx": new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  ".pptx": new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
  ".txt": new Set(["text/plain"]),
  ".md": new Set(["text/markdown", "text/plain"]),
  ".csv": new Set(["text/csv", "application/csv", "text/plain"]),
  ".json": new Set(["application/json", "text/json", "text/plain"]),
  ".zip": new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"]),
  ".rar": new Set(["application/vnd.rar", "application/x-rar-compressed", "application/octet-stream"]),
  ".7z": new Set(["application/x-7z-compressed", "application/octet-stream"]),
  ".mp3": new Set(["audio/mpeg", "audio/mp3", "application/octet-stream"]),
  ".wav": new Set(["audio/wav", "audio/x-wav", "application/octet-stream"]),
  ".ogg": new Set(["audio/ogg", "application/ogg", "application/octet-stream"]),
  ".m4a": new Set(["audio/mp4", "audio/x-m4a", "application/octet-stream"]),
  ".mp4": new Set(["video/mp4", "application/octet-stream"]),
  ".webm": new Set(["video/webm", "application/octet-stream"]),
  ".mov": new Set(["video/quicktime", "application/octet-stream"]),
};

function cleanFilename(value: string) {
  return value.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "file";
}

export function validateDeclaredMime(filename: string, mimeType: string) {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  const allowed = MIME_FAMILIES[ext];
  if (!allowed || !ALLOWED_ATTACHMENT_TYPES.has(normalized) && normalized !== "application/x-zip-compressed"
    && normalized !== "application/csv" && normalized !== "text/json" && normalized !== "audio/mp3"
    && normalized !== "audio/x-wav" && normalized !== "application/ogg" && normalized !== "audio/mp4"
    && normalized !== "audio/x-m4a" && normalized !== "video/quicktime") {
    throw new ApiError(415, "FILE_MIME_UNSUPPORTED", "نوع الملف المعلن غير مدعوم.");
  }
  if (!allowed.has(normalized)) {
    throw new ApiError(415, "FILE_MIME_MISMATCH", "نوع الملف المعلن لا يطابق امتداده.");
  }
  return normalized;
}

export async function storeAttachment(input: {
  organizationId: string;
  conversationId?: string;
  uploadedByUserId?: string;
  restrictConversationToUserId?: string;
  source: "web" | "api" | "telegram";
  filename: string;
  mimeType: string;
  content: Buffer;
  telegramFileId?: string;
}) {
  if (input.content.byteLength === 0) throw new ApiError(400, "FILE_EMPTY", "الملف فارغ.");
  if (input.content.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(413, "FILE_TOO_LARGE", "الحد الأقصى للملف 10 ميجابايت.");
  }
  const declaredMime = validateDeclaredMime(input.filename, input.mimeType);
  if (input.conversationId) {
    const [conversation] = await db().select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
      input.restrictConversationToUserId ? eq(conversations.createdByUserId, input.restrictConversationToUserId) : undefined,
      isNull(conversations.deletedAt),
    )).limit(1);
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
  }
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const id = crypto.randomUUID();
  const configuredDriver = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase();
  const legacyDatabase = !configuredDriver || configuredDriver === "database";
  const storage = legacyDatabase ? null : objectStorage();
  const objectKey = storage ? `${input.organizationId}/${id}` : null;
  if (storage && objectKey) await storage.put({ key: objectKey, body: input.content, contentType: declaredMime, sha256 });
  let persisted = false;
  try {
    const [created] = await db().insert(attachments).values({
      id,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      uploadedByUserId: input.uploadedByUserId,
      source: input.source,
      filename: cleanFilename(input.filename),
      mimeType: declaredMime,
      sizeBytes: input.content.byteLength,
      sha256,
      content: legacyDatabase ? input.content : null,
      storageDriver: storage?.driver ?? "database",
      objectKey,
      telegramFileId: input.telegramFileId,
      processingStatus: "quarantined",
      processingErrorCode: null,
    }).returning({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      sha256: attachments.sha256,
      source: attachments.source,
      detectedType: attachments.detectedType,
      processingStatus: attachments.processingStatus,
      createdAt: attachments.createdAt,
    });
    if (!created) throw new Error("ATTACHMENT_CREATE_FAILED");
    persisted = true;
    try {
      const queued = await enqueueAttachmentScan({
        organizationId: input.organizationId,
        attachmentId: created.id,
      });
      return { ...created, workerJobId: queued.jobId };
    } catch (error) {
      await db().update(attachments).set({
        processingStatus: "failed",
        processingErrorCode: "ATTACHMENT_SCAN_QUEUE_FAILED",
        updatedAt: new Date(),
      }).where(and(
        eq(attachments.id, created.id),
        eq(attachments.organizationId, input.organizationId),
      ));
      throw new ApiError(503, "ATTACHMENT_SCAN_QUEUE_FAILED", "تعذر إضافة الملف إلى قائمة الفحص الأمني.", {
        cause: error instanceof Error ? error.name : "UNKNOWN",
      });
    }
  } catch (error) {
    if (!persisted && storage && objectKey) await storage.delete(objectKey).catch(() => undefined);
    throw error;
  }
}

export async function readAttachmentContent(file: { content: Buffer | null; storageDriver: string; objectKey: string | null }) {
  if (file.storageDriver === "database") {
    if (!file.content) throw new ApiError(500, "ATTACHMENT_CONTENT_MISSING", "محتوى الملف غير متاح.");
    return new Uint8Array(file.content);
  }
  if (!file.objectKey) throw new ApiError(500, "ATTACHMENT_OBJECT_MISSING", "مرجع تخزين الملف غير متاح.");
  if (file.storageDriver !== "local" && file.storageDriver !== "r2") throw new ApiError(500, "ATTACHMENT_STORAGE_INVALID", "مرجع تخزين الملف غير صالح.");
  return objectStorage(file.storageDriver).get(file.objectKey);
}

export async function deleteAttachmentContent(file: { content: Buffer | null; storageDriver: string; objectKey: string | null }) {
  if (file.storageDriver === "database" || !file.objectKey) return;
  if (file.storageDriver !== "local" && file.storageDriver !== "r2") throw new ApiError(500, "ATTACHMENT_STORAGE_INVALID", "مرجع تخزين الملف غير صالح.");
  await objectStorage(file.storageDriver).delete(file.objectKey);
}

export async function waitForAttachmentReady(organizationId: string, attachmentId: string, timeoutMs = 30_000) {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 1_000), 60_000);
  while (Date.now() < deadline) {
    const [file] = await db().select({
      processingStatus: attachments.processingStatus,
      processingErrorCode: attachments.processingErrorCode,
    }).from(attachments).where(and(
      eq(attachments.id, attachmentId),
      eq(attachments.organizationId, organizationId),
      isNull(attachments.deletedAt),
    )).limit(1);
    if (!file) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "الملف غير موجود.");
    if (file.processingStatus === "ready") return;
    if (file.processingStatus === "failed") {
      throw new ApiError(422, file.processingErrorCode ?? "ATTACHMENT_SCAN_FAILED", "فشل الفحص الأمني للملف.");
    }
    if (file.processingStatus === "quarantined" && file.processingErrorCode === "MALWARE_DETECTED") {
      throw new ApiError(422, "MALWARE_DETECTED", "رفض الملف بعد اكتشاف محتوى ضار.");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new ApiError(409, "ATTACHMENT_SCAN_PENDING", "ما زال الملف قيد الفحص الأمني.");
}

export async function attachmentContext(organizationId: string, conversationId: string, ids: string[]) {
  if (ids.length === 0) return { text: "", rows: [] };
  const rows = await db().select({
    id: attachments.id,
    filename: attachments.filename,
    mimeType: attachments.mimeType,
    sizeBytes: attachments.sizeBytes,
    content: attachments.content,
    storageDriver: attachments.storageDriver,
    objectKey: attachments.objectKey,
    extractedText: attachments.extractedText,
    processingStatus: attachments.processingStatus,
  }).from(attachments).where(and(
    eq(attachments.organizationId, organizationId),
    eq(attachments.conversationId, conversationId),
    isNull(attachments.deletedAt),
  ));
  const selected = rows.filter((row) => ids.includes(row.id));
  if (selected.length !== ids.length) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "أحد الملفات غير موجود.");
  const hydrated = await Promise.all(selected.map(async (row) => ({
    ...row,
    content: ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(row.mimeType)
      ? Buffer.from(await readAttachmentContent(row))
      : Buffer.alloc(0),
  })));
  const parts = hydrated.map((row) => {
    if (row.processingStatus !== "ready") {
      throw new ApiError(409, "FILE_NOT_READY", `الملف ${row.filename} لم يجهز للتحليل بعد.`);
    }
    if (row.extractedText) {
      return `\n\n[مرفق مفهرس: ${row.filename}]\n${row.extractedText.slice(0, 40_000)}`;
    }
    return `\n\n[مرفق: ${row.filename}، النوع ${row.mimeType}، الحجم ${row.sizeBytes} بايت]`;
  });
  return { text: parts.join(""), rows: hydrated };
}
