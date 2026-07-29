import type { InputKind } from "@/server/models/router";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/ogg"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

export function inputKindForAttachments(mimeTypes: string[]): InputKind {
  if (mimeTypes.some((mimeType) => IMAGE_TYPES.has(mimeType))) return "image";
  if (mimeTypes.some((mimeType) => AUDIO_TYPES.has(mimeType))) return "audio";
  if (mimeTypes.some((mimeType) => VIDEO_TYPES.has(mimeType))) return "video";
  return mimeTypes.length > 0 ? "file" : "text";
}
