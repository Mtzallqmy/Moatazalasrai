import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversations } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { processFile } from "@/server/files/processor";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
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
  "application/x-7z-compressed",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
]);

function cleanFilename(value: string) {
  return value.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "file";
}

export async function storeAttachment(input: {
  organizationId: string;
  conversationId?: string;
  uploadedByUserId?: string;
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
  const processed = processFile(input.filename, input.mimeType, input.content);
  if (input.conversationId) {
    const [conversation] = await db().select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
      isNull(conversations.deletedAt),
    )).limit(1);
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
  }
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const [created] = await db().insert(attachments).values({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    uploadedByUserId: input.uploadedByUserId,
    source: input.source,
    filename: cleanFilename(input.filename),
    mimeType: input.mimeType,
    sizeBytes: input.content.byteLength,
    sha256,
    content: input.content,
    telegramFileId: input.telegramFileId,
    detectedType: processed.detectedType,
    processingStatus: "ready",
    extractedText: processed.extractedText,
    archiveEntryCount: processed.archiveEntryCount,
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
  return created;
}

export async function attachmentContext(organizationId: string, conversationId: string, ids: string[]) {
  if (ids.length === 0) return { text: "", rows: [] };
  const rows = await db().select({
    id: attachments.id,
    filename: attachments.filename,
    mimeType: attachments.mimeType,
    sizeBytes: attachments.sizeBytes,
    content: attachments.content,
    extractedText: attachments.extractedText,
    processingStatus: attachments.processingStatus,
  }).from(attachments).where(and(
    eq(attachments.organizationId, organizationId),
    eq(attachments.conversationId, conversationId),
    isNull(attachments.deletedAt),
  ));
  const selected = rows.filter((row) => ids.includes(row.id));
  if (selected.length !== ids.length) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "أحد الملفات غير موجود.");
  const parts = selected.map((row) => {
    if (row.processingStatus !== "ready") {
      throw new ApiError(409, "FILE_NOT_READY", `الملف ${row.filename} لم يجهز للتحليل بعد.`);
    }
    if (row.extractedText) {
      return `\n\n[مرفق مفهرس: ${row.filename}]\n${row.extractedText.slice(0, 40_000)}`;
    }
    return `\n\n[مرفق: ${row.filename}، النوع ${row.mimeType}، الحجم ${row.sizeBytes} بايت]`;
  });
  return { text: parts.join(""), rows: selected };
}
