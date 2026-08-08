import { createHash } from "node:crypto";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachmentIntelligence } from "@/db/file-intelligence-schema";
import { attachments, conversations } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { processFile } from "@/server/files/processor";
import { indexProcessedAttachment } from "@/server/files/indexer";
import { objectStorage } from "@/lib/storage/object-storage";

const configuredMaxBytes = Number(process.env.MAX_ATTACHMENT_BYTES ?? 10 * 1024 * 1024);
export const MAX_ATTACHMENT_BYTES = Number.isFinite(configuredMaxBytes)
  ? Math.min(Math.max(Math.floor(configuredMaxBytes), 1024), 25 * 1024 * 1024)
  : 10 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".yaml", ".yml", ".log", ".ini", ".conf", ".env", ".sql",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".php", ".rb", ".swift",
  ".kt", ".kts", ".dart", ".vue", ".svelte", ".sh", ".bash", ".ps1", ".toml", ".gradle", ".html", ".htm", ".css", ".scss",
  ".pdf", ".doc", ".docx", ".odt", ".rtf", ".epub", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp",
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg", ".heic", ".heif",
  ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov",
]);
const ALLOWED_MIME_PREFIXES = ["text/", "image/", "audio/", "video/"];
const ALLOWED_APPLICATION_MIMES = new Set([
  "application/octet-stream", "application/pdf", "application/json", "application/xml", "application/zip", "application/x-zip-compressed",
  "application/vnd.rar", "application/x-rar-compressed", "application/x-7z-compressed", "application/gzip", "application/x-gzip", "application/x-tar",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.presentation",
  "application/rtf", "application/epub+zip", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
]);
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  ...ALLOWED_APPLICATION_MIMES,
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff", "image/svg+xml", "image/heic", "image/heif",
  "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "video/mp4", "video/webm", "video/quicktime",
  "text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "text/html", "text/css", "text/xml",
]);

export function cleanFilename(value: string) {
  return value.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "file";
}
function filenameExtension(filename: string) {
  return filename.toLowerCase() === "dockerfile" ? ".dockerfile" : path.extname(filename).toLowerCase();
}
function isOctet(mime: string) { return mime === "application/octet-stream"; }
function familyMatches(ext: string, mime: string) {
  if (!ext || ext === ".dockerfile") return mime.startsWith("text/") || mime === "application/octet-stream";
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg", ".heic", ".heif"].includes(ext)) return mime.startsWith("image/") || isOctet(mime);
  if (ext === ".pdf") return mime === "application/pdf" || isOctet(mime);
  if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) return mime.startsWith("audio/") || isOctet(mime);
  if ([".mp4", ".webm", ".mov"].includes(ext)) return mime.startsWith("video/") || isOctet(mime);
  if ([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"].includes(ext)) return ["application/zip", "application/x-zip-compressed", "application/vnd.rar", "application/x-rar-compressed", "application/x-7z-compressed", "application/gzip", "application/x-gzip", "application/x-tar", "application/octet-stream"].includes(mime);
  if ([".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".epub", ".doc", ".xls", ".ppt", ".rtf"].includes(ext)) return mime.startsWith("application/") && !["application/pdf", "application/x-msdownload"].includes(mime);
  if (TEXT_EXT_MIME_FAMILY.has(ext)) return mime.startsWith("text/") || ["application/json", "application/xml", "application/octet-stream"].includes(mime);
  return true;
}
const TEXT_EXT_MIME_FAMILY = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".yaml", ".yml", ".log", ".ini", ".conf", ".env", ".sql",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".php", ".rb", ".swift",
  ".kt", ".kts", ".dart", ".vue", ".svelte", ".sh", ".bash", ".ps1", ".toml", ".gradle", ".html", ".htm", ".css", ".scss",
]);

export function validateDeclaredMime(filename: string, mimeType: string) {
  const normalized = (mimeType || "application/octet-stream").split(";", 1)[0]!.trim().toLowerCase() || "application/octet-stream";
  const ext = filenameExtension(filename);
  const extensionAllowed = SUPPORTED_EXTENSIONS.has(ext) || ext === ".dockerfile" || !ext;
  const mimeAllowed = ALLOWED_APPLICATION_MIMES.has(normalized) || ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  if (!extensionAllowed) throw new ApiError(415, "UNSUPPORTED_FILE_TYPE", "امتداد الملف غير مدعوم للتحليل الآمن.");
  if (!mimeAllowed) throw new ApiError(415, "UNSUPPORTED_FILE_TYPE", "نوع الملف المعلن غير مدعوم.");
  if (!familyMatches(ext, normalized)) throw new ApiError(415, "FILE_TYPE_MISMATCH", "نوع الملف المعلن لا يطابق امتداده.");
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
  if (input.content.byteLength > MAX_ATTACHMENT_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", `الملف يتجاوز الحد الأقصى المسموح (${MAX_ATTACHMENT_BYTES} بايت).`);
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

  const processed = processFile(input.filename, declaredMime, input.content);
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const id = crypto.randomUUID();
  const configuredDriver = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase();
  const legacyDatabase = !configuredDriver || configuredDriver === "database";
  const storage = legacyDatabase ? null : objectStorage();
  const objectKey = storage ? `${input.organizationId}/${id}` : null;
  if (storage && objectKey) await storage.put({ key: objectKey, body: input.content, contentType: declaredMime, sha256 });

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
      detectedType: processed.detectedType,
      processingStatus: "processing",
      extractedText: processed.extractedText || null,
      archiveEntryCount: processed.archiveEntryCount,
    }).returning({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      sha256: attachments.sha256,
      source: attachments.source,
      detectedType: attachments.detectedType,
      createdAt: attachments.createdAt,
    });
    if (!created) throw new Error("ATTACHMENT_CREATE_FAILED");

    const indexed = await indexProcessedAttachment({ attachmentId: id, organizationId: input.organizationId, conversationId: input.conversationId, processed });
    const legacyStatus = indexed.status === "unsupported" ? "failed" : "ready";
    await db().update(attachments).set({
      processingStatus: legacyStatus,
      processingErrorCode: indexed.status === "unsupported" ? processed.warnings[0] ?? "UNSUPPORTED_FILE_TYPE" : null,
      updatedAt: new Date(),
    }).where(and(eq(attachments.id, id), eq(attachments.organizationId, input.organizationId)));

    return {
      ...created,
      processingStatus: indexed.status,
      intelligenceStatus: indexed.status,
      chunkCount: indexed.chunkCount,
      indexedAt: indexed.indexedAt,
      warnings: processed.warnings,
    };
  } catch (error) {
    await db().delete(attachments).where(and(eq(attachments.id, id), eq(attachments.organizationId, input.organizationId))).catch(() => undefined);
    if (storage && objectKey) await storage.delete(objectKey).catch(() => undefined);
    throw error;
  }
}

export async function readAttachmentContent(file: { content: Buffer | null; storageDriver: string; objectKey: string | null }) {
  if (file.storageDriver === "database") {
    if (!file.content) throw new ApiError(500, "FILE_NOT_FOUND", "محتوى الملف غير متاح.");
    return new Uint8Array(file.content);
  }
  if (!file.objectKey) throw new ApiError(500, "FILE_NOT_FOUND", "مرجع تخزين الملف غير متاح.");
  if (file.storageDriver !== "local" && file.storageDriver !== "r2") throw new ApiError(500, "FILE_PROCESSING_FAILED", "مرجع تخزين الملف غير صالح.");
  return objectStorage(file.storageDriver).get(file.objectKey);
}

export async function deleteAttachmentContent(file: { content: Buffer | null; storageDriver: string; objectKey: string | null }) {
  if (file.storageDriver === "database" || !file.objectKey) return;
  if (file.storageDriver !== "local" && file.storageDriver !== "r2") throw new ApiError(500, "FILE_PROCESSING_FAILED", "مرجع تخزين الملف غير صالح.");
  await objectStorage(file.storageDriver).delete(file.objectKey);
}

export async function processStoredAttachment(attachmentId: string, organizationId: string) {
  const [file] = await db().select().from(attachments).where(and(
    eq(attachments.id, attachmentId), eq(attachments.organizationId, organizationId), isNull(attachments.deletedAt),
  )).limit(1);
  if (!file) throw new ApiError(404, "FILE_NOT_FOUND", "الملف غير موجود.");
  try {
    await db().update(attachments).set({ processingStatus: "processing", processingErrorCode: null, updatedAt: new Date() })
      .where(and(eq(attachments.id, attachmentId), eq(attachments.organizationId, organizationId)));
    const content = Buffer.from(await readAttachmentContent(file));
    const actualSha256 = createHash("sha256").update(content).digest("hex");
    if (content.byteLength !== file.sizeBytes || actualSha256 !== file.sha256) throw new ApiError(422, "FILE_INTEGRITY_FAILED", "فشل التحقق من سلامة الملف المرفوع.");
    const processed = processFile(file.filename, file.mimeType, content);
    const indexed = await indexProcessedAttachment({ attachmentId, organizationId, conversationId: file.conversationId ?? undefined, processed });
    await db().update(attachments).set({
      detectedType: processed.detectedType,
      extractedText: processed.extractedText || null,
      archiveEntryCount: processed.archiveEntryCount,
      processingStatus: indexed.status === "unsupported" ? "failed" : "ready",
      processingErrorCode: indexed.status === "unsupported" ? processed.warnings[0] ?? "UNSUPPORTED_FILE_TYPE" : null,
      updatedAt: new Date(),
    }).where(and(eq(attachments.id, attachmentId), eq(attachments.organizationId, organizationId)));
    return { status: indexed.status, chunkCount: indexed.chunkCount, indexedAt: indexed.indexedAt, warnings: processed.warnings };
  } catch (error) {
    await db().update(attachments).set({ processingStatus: "failed", processingErrorCode: error instanceof ApiError ? error.code : "FILE_PROCESSING_FAILED", updatedAt: new Date() })
      .where(and(eq(attachments.id, attachmentId), eq(attachments.organizationId, organizationId)));
    throw error;
  }
}

/** Legacy explicit-only context helper retained for non-chat callers. New chat requests use resolveAttachmentContext. */
export async function attachmentContext(organizationId: string, conversationId: string, ids: string[]) {
  if (ids.length === 0) return { text: "", rows: [] };
  const rows = await db().select({
    id: attachments.id, filename: attachments.filename, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes,
    content: attachments.content, storageDriver: attachments.storageDriver, objectKey: attachments.objectKey,
    extractedText: attachments.extractedText, processingStatus: attachments.processingStatus, intelligenceStatus: attachmentIntelligence.status,
  }).from(attachments).leftJoin(attachmentIntelligence, eq(attachmentIntelligence.attachmentId, attachments.id)).where(and(
    eq(attachments.organizationId, organizationId), eq(attachments.conversationId, conversationId), inArray(attachments.id, ids), isNull(attachments.deletedAt),
  ));
  if (rows.length !== ids.length) throw new ApiError(404, "FILE_NOT_FOUND", "أحد الملفات غير موجود.");
  const hydrated = await Promise.all(rows.map(async (row) => ({ ...row,
    content: ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(row.mimeType) ? Buffer.from(await readAttachmentContent(row)) : Buffer.alloc(0),
  })));
  const parts = hydrated.map((row) => row.extractedText ? `\n\n[File: ${row.filename}]\n${row.extractedText.slice(0, 40_000)}` : `\n\n[File: ${row.filename}; status=${row.intelligenceStatus ?? row.processingStatus}]`);
  return { text: parts.join(""), rows: hydrated };
}
