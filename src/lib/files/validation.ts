export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const acceptedFileExtensions = [
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".pdf", ".docx", ".xlsx", ".pptx",
  ".txt", ".md", ".csv", ".json",
  ".zip", ".rar", ".7z",
  ".mp3", ".wav", ".ogg", ".m4a",
  ".mp4", ".webm", ".mov",
] as const;

export const acceptedFileInput = acceptedFileExtensions.join(",");

export type ClientFileValidation = { valid: true } | { valid: false; code: "FILE_EMPTY" | "FILE_TOO_LARGE" | "FILE_TYPE_UNSUPPORTED"; message: string };

export function validateClientFile(
  file: { name: string; size: number; type?: string },
  maxBytes = DEFAULT_MAX_FILE_BYTES,
): ClientFileValidation {
  if (file.size <= 0) return { valid: false, code: "FILE_EMPTY", message: "الملف فارغ." };
  if (file.size > maxBytes) {
    return { valid: false, code: "FILE_TOO_LARGE", message: `يتجاوز الملف الحد المسموح (${Math.ceil(maxBytes / 1024 / 1024)}MB).` };
  }
  const name = file.name.toLowerCase();
  if (!acceptedFileExtensions.some((extension) => name.endsWith(extension))) {
    return { valid: false, code: "FILE_TYPE_UNSUPPORTED", message: "امتداد الملف غير مدعوم." };
  }
  return { valid: true };
}

export function humanFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function isImageMime(mimeType: string) {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType);
}
