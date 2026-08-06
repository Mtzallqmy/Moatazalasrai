// Telegram Bot API client used by the shared channel adapter and central client runtime.
import { ApiError } from "@/lib/http/api";
import { integrationFetch } from "./http";

type TelegramEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export type TelegramBot = {
  id: number;
  username?: string;
  first_name: string;
};

export type TelegramInlineButton = {
  title: string;
  id?: string;
  url?: string;
};

export const CENTRAL_TELEGRAM_COMMANDS = [
  { command: "start", description: "فتح القائمة الرئيسية" },
  { command: "help", description: "عرض القدرات المتاحة" },
  { command: "status", description: "حالة الحساب والجلسة" },
  { command: "agents", description: "الوكلاء المتاحون" },
  { command: "new", description: "بدء محادثة حقيقية" },
  { command: "files", description: "الملفات والوسائط" },
  { command: "unlink", description: "فصل حساب Telegram" },
  { command: "cancel", description: "إلغاء العملية النشطة" },
] as const;

async function telegramCall<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await integrationFetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
  );
  const payload = await response.json().catch(() => null) as TelegramEnvelope<T> | null;
  if (!response.ok || !payload?.ok || payload.result === undefined) {
    throw new ApiError(
      response.status === 401 ? 422 : 502,
      response.status === 401 ? "TELEGRAM_TOKEN_INVALID" : "TELEGRAM_API_ERROR",
      response.status === 401 ? "توكن Telegram غير صالح." : "تعذر تنفيذ طلب Telegram حاليًا.",
      { telegramStatus: payload?.error_code, telegramDescription: payload?.description?.slice(0, 240) },
    );
  }
  return payload.result;
}

function safeText(value: string) {
  const text = value.trim();
  if (!text) throw new ApiError(500, "TELEGRAM_EMPTY_MESSAGE", "رفض إرسال رسالة Telegram فارغة.");
  return text;
}

function replyMarkup(input: {
  buttons?: Array<{ id: string; title: string }>;
  buttonRows?: TelegramInlineButton[][];
  replyKeyboard?: string[][];
  removeKeyboard?: boolean;
}) {
  const legacyRows: TelegramInlineButton[][] | undefined = input.buttons
    ?.slice(0, 12)
    .map((button) => [{ title: button.title, id: button.id }]);
  const rows = (input.buttonRows ?? legacyRows)?.slice(0, 12).map((row) => row.slice(0, 4).map((button) => {
    const title = safeText(button.title).slice(0, 64);
    if (button.url) return { text: title, url: button.url };
    const callbackData = safeText(button.id ?? "cc.home");
    if (Buffer.byteLength(callbackData, "utf8") > 64) {
      throw new ApiError(500, "TELEGRAM_CALLBACK_TOO_LONG", "معرّف زر Telegram أطول من الحد المسموح.");
    }
    return { text: title, callback_data: callbackData };
  }));
  if (rows?.length) return { inline_keyboard: rows };
  if (input.replyKeyboard?.length) {
    return {
      keyboard: input.replyKeyboard.slice(0, 8).map((row) => row.slice(0, 4).map((label) => ({ text: safeText(label).slice(0, 64) }))),
      resize_keyboard: true,
      is_persistent: true,
    };
  }
  return input.removeKeyboard ? { remove_keyboard: true } : undefined;
}

export function verifyTelegramToken(token: string) {
  return telegramCall<TelegramBot>(token, "getMe");
}

export function configureTelegramWebhook(input: {
  token: string;
  url: string;
  secretToken: string;
}) {
  return telegramCall<boolean>(input.token, "setWebhook", {
    url: input.url,
    secret_token: input.secretToken,
    allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member"],
    drop_pending_updates: false,
  });
}

export function registerCentralTelegramCommands(token: string) {
  return telegramCall<boolean>(token, "setMyCommands", {
    commands: CENTRAL_TELEGRAM_COMMANDS,
    scope: { type: "all_private_chats" },
    language_code: "ar",
  });
}

export function sendTelegramMessage(input: {
  token: string;
  chatId: string;
  text: string;
  replyToMessageId?: string;
  buttons?: Array<{ id: string; title: string }>;
  buttonRows?: TelegramInlineButton[][];
  replyKeyboard?: string[][];
  removeKeyboard?: boolean;
}) {
  const text = safeText(input.text);
  if (text.length > 4096) throw new ApiError(500, "TELEGRAM_MESSAGE_TOO_LONG", "رسالة Telegram تتجاوز الحد ويجب تقسيمها.");
  const markup = replyMarkup(input);
  return telegramCall<{ message_id?: number }>(input.token, "sendMessage", {
    chat_id: input.chatId,
    text,
    disable_web_page_preview: true,
    ...(input.replyToMessageId ? { reply_parameters: { message_id: Number(input.replyToMessageId) } } : {}),
    ...(markup ? { reply_markup: markup } : {}),
  });
}

export function editTelegramMessage(input: {
  token: string;
  chatId: string;
  messageId: string;
  text: string;
  buttonRows?: TelegramInlineButton[][];
}) {
  const text = safeText(input.text);
  if (text.length > 4096) throw new ApiError(500, "TELEGRAM_MESSAGE_TOO_LONG", "رسالة Telegram تتجاوز الحد ويجب تقسيمها.");
  const markup = replyMarkup({ buttonRows: input.buttonRows });
  return telegramCall<{ message_id?: number }>(input.token, "editMessageText", {
    chat_id: input.chatId,
    message_id: Number(input.messageId),
    text,
    disable_web_page_preview: true,
    ...(markup ? { reply_markup: markup } : {}),
  });
}

export function sendTelegramChatAction(input: {
  token: string;
  chatId: string;
  action?: "typing" | "upload_document" | "upload_photo" | "record_voice" | "upload_video";
}) {
  return telegramCall<boolean>(input.token, "sendChatAction", {
    chat_id: input.chatId,
    action: input.action ?? "typing",
  });
}

export function answerTelegramCallback(input: { token: string; callbackQueryId: string; text?: string }) {
  return telegramCall<boolean>(input.token, "answerCallbackQuery", {
    callback_query_id: input.callbackQueryId,
    ...(input.text ? { text: input.text.slice(0, 200) } : {}),
  });
}

export async function downloadTelegramFile(token: string, fileId: string): Promise<{
  content: Buffer;
  filePath: string;
}> {
  const metadata = await telegramCall<{ file_path?: string }>(token, "getFile", { file_id: fileId });
  if (!metadata.file_path || metadata.file_path.includes("..")) {
    throw new ApiError(502, "TELEGRAM_FILE_INVALID", "تعذر تحديد ملف Telegram.");
  }
  const response = await integrationFetch(
    `https://api.telegram.org/file/bot${encodeURIComponent(token)}/${metadata.file_path}`,
    { method: "GET", headers: { accept: "application/octet-stream" } },
    30_000,
  );
  if (!response.ok) throw new ApiError(502, "TELEGRAM_FILE_DOWNLOAD_FAILED", "تعذر تنزيل ملف Telegram.");
  const content = Buffer.from(await response.arrayBuffer());
  if (content.byteLength > 20 * 1024 * 1024) {
    throw new ApiError(413, "FILE_TOO_LARGE", "حجم الملف يتجاوز 20 ميجابايت.");
  }
  return { content, filePath: metadata.file_path };
}
