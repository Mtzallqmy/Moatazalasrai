// Telegram implementation of the shared channel adapter contract.
import { ApiError } from "@/lib/http/api";
import {
  downloadTelegramFile,
  sendTelegramMessage,
  verifyTelegramToken,
} from "@/lib/integrations/telegram";
import type {
  ChannelAdapter,
  ChannelIncomingAttachment,
} from "./types";

type TelegramUser = { id?: number; username?: string; first_name?: string; last_name?: string; language_code?: string };
type TelegramMessage = {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id?: number };
  chat?: { id?: number; username?: string; title?: string; first_name?: string };
  from?: TelegramUser;
  document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }>;
  audio?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
  voice?: { file_id?: string; mime_type?: string; file_size?: number };
  video?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
};
type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: {
    id?: string;
    data?: string;
    from?: TelegramUser;
    message?: TelegramMessage;
  };
};

function senderName(user: TelegramUser | undefined, chat: TelegramMessage["chat"]) {
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return fullName || user?.username || chat?.title || chat?.username || chat?.first_name;
}

function attachments(message: TelegramMessage): ChannelIncomingAttachment[] {
  const output: ChannelIncomingAttachment[] = [];
  if (message.document?.file_id) {
    output.push({
      externalId: message.document.file_id,
      kind: "file",
      filename: message.document.file_name,
      mimeType: message.document.mime_type,
      sizeBytes: message.document.file_size,
    });
  }
  const photo = message.photo?.at(-1);
  if (photo?.file_id) {
    output.push({
      externalId: photo.file_id,
      kind: "image",
      filename: `telegram-${message.message_id ?? "image"}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: photo.file_size,
    });
  }
  const audio = message.audio ?? message.voice;
  if (audio?.file_id) {
    const audioFilename = "file_name" in audio && typeof audio.file_name === "string"
      ? audio.file_name
      : `telegram-${message.message_id ?? "voice"}.ogg`;
    output.push({
      externalId: audio.file_id,
      kind: "audio",
      filename: audioFilename,
      mimeType: audio.mime_type,
      sizeBytes: audio.file_size,
    });
  }
  if (message.video?.file_id) {
    output.push({
      externalId: message.video.file_id,
      kind: "video",
      filename: message.video.file_name ?? `telegram-${message.message_id ?? "video"}.mp4`,
      mimeType: message.video.mime_type ?? "video/mp4",
      sizeBytes: message.video.file_size,
    });
  }
  return output;
}

function receivedAt(message: TelegramMessage) {
  return Number.isSafeInteger(message.date) ? new Date((message.date ?? 0) * 1000) : new Date();
}

export const telegramChannelAdapter: ChannelAdapter = {
  kind: "telegram",
  capabilities: new Set(["text", "images", "files", "audio", "video", "interactive", "reply"]),
  normalizeIncoming(payload, hints) {
    const update = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as TelegramUpdate
      : null;
    if (!update || !Number.isSafeInteger(update.update_id)) return [];
    const accountId = hints?.externalAccountId ?? "";
    const callback = update.callback_query;
    if (callback?.id && callback.message?.chat?.id !== undefined && callback.from?.id !== undefined) {
      return [{
        eventId: String(update.update_id),
        externalAccountId: accountId,
        conversationExternalId: String(callback.message.chat.id),
        senderExternalId: String(callback.from.id),
        senderDisplayName: senderName(callback.from, callback.message.chat),
        text: callback.data?.trim() ?? "",
        messageType: "interactive",
        interactiveActionId: callback.data?.trim() || undefined,
        replyToExternalId: callback.message.message_id === undefined ? undefined : String(callback.message.message_id),
        locale: callback.from.language_code,
        attachments: [],
        receivedAt: receivedAt(callback.message),
      }];
    }
    const message = update.message;
    if (!message || message.chat?.id === undefined) return [];
    const sender = message.from?.id ?? message.chat.id;
    const media = attachments(message);
    return [{
      eventId: String(update.update_id),
      externalAccountId: accountId,
      conversationExternalId: String(message.chat.id),
      senderExternalId: String(sender),
      senderDisplayName: senderName(message.from, message.chat),
      text: (message.text ?? message.caption ?? "").trim(),
      messageType: media.length ? "media" : "text",
      replyToExternalId: message.reply_to_message?.message_id === undefined
        ? undefined
        : String(message.reply_to_message.message_id),
      locale: message.from?.language_code,
      attachments: media,
      receivedAt: receivedAt(message),
    }];
  },
  async send(context, message) {
    if (context.credentials.kind !== "telegram") throw new Error("TELEGRAM_CREDENTIALS_REQUIRED");
    const buttons = message.buttons?.length
      ? message.buttons
      : message.list?.actions;
    const result = await sendTelegramMessage({
      token: context.credentials.token,
      chatId: message.to,
      text: message.text,
      replyToMessageId: message.replyToExternalId,
      buttons,
    });
    return { externalMessageId: result.message_id === undefined ? `telegram-${Date.now()}` : String(result.message_id) };
  },
  async downloadAttachment(context, attachment) {
    if (context.credentials.kind !== "telegram") throw new Error("TELEGRAM_CREDENTIALS_REQUIRED");
    const downloaded = await downloadTelegramFile(context.credentials.token, attachment.externalId);
    const fallback = downloaded.filePath.split("/").at(-1) || `telegram-${attachment.externalId}`;
    return {
      content: downloaded.content,
      filename: attachment.filename || fallback,
      mimeType: attachment.mimeType || "application/octet-stream",
    };
  },
  async test(context) {
    if (context.credentials.kind !== "telegram") throw new Error("TELEGRAM_CREDENTIALS_REQUIRED");
    const started = performance.now();
    try {
      const bot = await verifyTelegramToken(context.credentials.token) as { id: string | number; first_name?: string; username?: string };
      if (context.externalAccountId && context.externalAccountId !== String(bot.id)) {
        throw new ApiError(422, "TELEGRAM_BOT_ID_MISMATCH", "توكن Telegram يعود لبوت مختلف عن الاتصال المحفوظ.");
      }
      return {
        status: "healthy" as const,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        details: `${bot.first_name}${bot.username ? ` (@${bot.username})` : ""}`,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        details: error instanceof Error ? error.message : "تعذر الاتصال بـTelegram.",
        errorCode: error instanceof ApiError ? error.code : "TELEGRAM_API_ERROR",
      };
    }
  },
};
