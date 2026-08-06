import { z } from "zod";
import { ApiError } from "@/lib/http/api";

const userSchema = z.object({
  id: z.number().int().safe(),
  username: z.string().max(64).optional(),
  first_name: z.string().max(256).optional(),
  last_name: z.string().max(256).optional(),
  language_code: z.string().max(16).optional(),
}).passthrough();

const chatSchema = z.object({ id: z.number().int().safe() }).passthrough();

const fileSchema = z.object({
  file_id: z.string().min(1).max(512),
  file_name: z.string().max(512).optional(),
  mime_type: z.string().max(256).optional(),
  file_size: z.number().int().nonnegative().optional(),
}).passthrough();

const photoSchema = z.object({
  file_id: z.string().min(1).max(512),
  file_size: z.number().int().nonnegative().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
}).passthrough();

const messageSchema = z.object({
  message_id: z.number().int().safe(),
  date: z.number().int().nonnegative().optional(),
  text: z.string().max(30_000).optional(),
  caption: z.string().max(30_000).optional(),
  chat: chatSchema,
  from: userSchema.optional(),
  document: fileSchema.optional(),
  photo: z.array(photoSchema).max(20).optional(),
  audio: fileSchema.optional(),
  voice: fileSchema.optional(),
  video: fileSchema.optional(),
}).passthrough();

const callbackSchema = z.object({
  id: z.string().min(1).max(256),
  data: z.string().max(64).optional(),
  from: userSchema,
  message: messageSchema.optional(),
}).passthrough();

const rawUpdateSchema = z.object({
  update_id: z.number().int().safe(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
  callback_query: callbackSchema.optional(),
  my_chat_member: z.object({
    chat: chatSchema,
    from: userSchema,
  }).passthrough().optional(),
}).passthrough().superRefine((value, context) => {
  const count = [value.message, value.edited_message, value.callback_query, value.my_chat_member]
    .filter(Boolean).length;
  if (count !== 1) context.addIssue({ code: "custom", message: "Telegram update must contain one supported update type." });
});

export type TelegramAttachmentKind = "file" | "image" | "audio" | "video";
export type TelegramIncomingAttachment = {
  fileId: string;
  kind: TelegramAttachmentKind;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type ParsedTelegramUpdate = {
  updateId: string;
  kind: "message" | "edited_message" | "callback_query" | "my_chat_member";
  telegramUserId: string;
  chatId: string;
  messageId?: string;
  callbackId?: string;
  callbackData?: string;
  text: string;
  user: {
    username?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: string;
  };
  attachments: TelegramIncomingAttachment[];
  raw: Record<string, unknown>;
};

function attachmentList(message: z.infer<typeof messageSchema>): TelegramIncomingAttachment[] {
  const output: TelegramIncomingAttachment[] = [];
  if (message.document) output.push({
    fileId: message.document.file_id,
    kind: "file",
    filename: message.document.file_name,
    mimeType: message.document.mime_type,
    sizeBytes: message.document.file_size,
  });
  const photo = message.photo?.at(-1);
  if (photo) output.push({
    fileId: photo.file_id,
    kind: "image",
    filename: `telegram-${message.message_id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: photo.file_size,
  });
  const audio = message.audio ?? message.voice;
  if (audio) output.push({
    fileId: audio.file_id,
    kind: "audio",
    filename: audio.file_name ?? `telegram-${message.message_id}.ogg`,
    mimeType: audio.mime_type ?? "audio/ogg",
    sizeBytes: audio.file_size,
  });
  if (message.video) output.push({
    fileId: message.video.file_id,
    kind: "video",
    filename: message.video.file_name ?? `telegram-${message.message_id}.mp4`,
    mimeType: message.video.mime_type ?? "video/mp4",
    sizeBytes: message.video.file_size,
  });
  return output;
}

export function parseTelegramUpdate(payload: unknown): ParsedTelegramUpdate {
  const result = rawUpdateSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(400, "TELEGRAM_UPDATE_INVALID", "تحديث Telegram غير صالح.");
  }
  const raw = result.data as unknown as Record<string, unknown>;
  const callback = result.data.callback_query;
  const member = result.data.my_chat_member;
  const message = callback?.message ?? result.data.message ?? result.data.edited_message;
  const user = callback?.from ?? message?.from ?? member?.from;
  const chat = message?.chat ?? member?.chat;
  if (!user || !chat) throw new ApiError(400, "TELEGRAM_UPDATE_IDENTITY_MISSING", "تعذر تحديد مرسل تحديث Telegram.");
  const kind = callback
    ? "callback_query" as const
    : result.data.edited_message
      ? "edited_message" as const
      : member
        ? "my_chat_member" as const
        : "message" as const;
  return {
    updateId: String(result.data.update_id),
    kind,
    telegramUserId: String(user.id),
    chatId: String(chat.id),
    messageId: message ? String(message.message_id) : undefined,
    callbackId: callback?.id,
    callbackData: callback?.data,
    text: (callback?.data ?? message?.text ?? message?.caption ?? "").trim(),
    user: {
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      languageCode: user.language_code,
    },
    attachments: message ? attachmentList(message) : [],
    raw,
  };
}

export function telegramCommand(text: string) {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.+))?$/i.exec(text.trim());
  return match ? { name: match[1]!.toLowerCase(), argument: match[2]?.trim() ?? "" } : null;
}
