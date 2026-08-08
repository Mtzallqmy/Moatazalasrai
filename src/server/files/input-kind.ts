import type { InputKind } from "@/server/models/router";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Chat attachments are normalized by the File Intelligence Layer. Only actual native
 * vision payloads require image capability; parsed documents/archives/spreadsheets
 * are text context and must remain usable with providers that do not expose native
 * file APIs.
 */
export function inputKindForAttachments(mimeTypes: string[]): InputKind {
  if (mimeTypes.some((mimeType) => IMAGE_TYPES.has(mimeType))) return "image";
  return "text";
}
