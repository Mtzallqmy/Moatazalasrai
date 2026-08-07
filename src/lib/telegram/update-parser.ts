import { z } from "zod";

const userSchema = z.object({
  id: z.number().int().safe(),
  username: z.string().max(64).optional(),
  first_name: z.string().max(128).optional(),
  last_name: z.string().max(128).optional(),
}).passthrough();

const chatSchema = z.object({ id: z.number().int().safe() }).passthrough();
const fileSchema = z.object({ file_id: z.string().min(1).max(512) }).passthrough();
const messageSchema = z.object({
  message_id: z.number().int().safe(),
  date: z.number().int().optional(),
  text: z.string().max(16_384).optional(),
  caption: z.string().max(4096).optional(),
  chat: chatSchema,
  from: userSchema.optional(),
  document: fileSchema.optional(),
  photo: z.array(fileSchema).max(20).optional(),
  audio: fileSchema.optional(),
  voice: fileSchema.optional(),
  video: fileSchema.optional(),
}).passthrough();

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().safe(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
  callback_query: z.object({
    id: z.string().min(1).max(256),
    data: z.string().max(64).optional(),
    from: userSchema,
    message: messageSchema.optional(),
  }).passthrough().optional(),
}).passthrough().refine((value) => Boolean(value.message || value.edited_message || value.callback_query), {
  message: "TELEGRAM_UPDATE_UNSUPPORTED",
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof messageSchema>;

export function parseTelegramUpdate(value: unknown) {
  return telegramUpdateSchema.parse(value);
}

export function telegramUpdateContext(update: TelegramUpdate) {
  const callback = update.callback_query;
  const message = callback?.message ?? update.message ?? update.edited_message;
  const user = callback?.from ?? message?.from;
  if (!message || !user) return null;
  return {
    updateId: update.update_id,
    message,
    user,
    chatId: String(message.chat.id),
    telegramUserId: String(user.id),
    callbackId: callback?.id ?? null,
    callbackData: callback?.data?.trim() ?? null,
    text: (message.text ?? message.caption ?? "").trim(),
    edited: Boolean(update.edited_message),
  };
}
