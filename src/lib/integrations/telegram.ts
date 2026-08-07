// Telegram Bot API client used by the shared channel adapter and central Telegram runtime.
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
  { command: "start", description: "بدء البوت وعرض القائمة" },
  { command: "help", description: "عرض المساعدة" },
  { command: "status", description: "حالة الحساب والجلسة" },
  { command: "agents", description: "عرض الوكلاء المتاحين" },
  { command: "teams", description: "عرض فرق الوكلاء" },
  { command: "runs", description: "عرض عمليات تشغيل الفرق" },
  { command: "new", description: "بدء محادثة حقيقية" },
  { command: "approvals", description: "عرض الموافقات المعلقة" },
  { command: "cancel", description: "إلغاء العملية الحالية" },
  { command: "unlink", description: "فصل حساب Telegram" },
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
      response.status === 401 ? "توكن Telegram غير صالح." : "رفض Telegram طلب التكامل.",
      { telegramStatus: payload?.error_code, telegramDescription: payload?.description?.slice(0, 240) },
    );
  }
  return payload.result;
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
    allowed_updates: ["message", "edited_message", "callback_query"],
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
  const text = input.text.trim();
  if (!text) throw new ApiError(500, "TELEGRAM_EMPTY_MESSAGE", "تم منع إرسال رسالة Telegram فارغة.");
  const safeText = text.length > 4096 ? `${text.slice(0, 4086)}…` : text;
  const legacyRows: TelegramInlineButton[][] | undefined = input.buttons
    ?.slice(0, 12)
    .map((button) => [{ title: button.title, id: button.id }]);
  const rows = (input.buttonRows ?? legacyRows)?.slice(0, 8).map((row) => row.slice(0, 4).map((button) => ({
    text: button.title.slice(0, 64),
    ...(button.url ? { url: button.url } : { callback_data: (button.id ?? "nav:home").slice(0, 64) }),
  })));
  const replyMarkup = rows?.length
    ? { inline_keyboard: rows }
    : input.replyKeyboard?.length
      ? {
          keyboard: input.replyKeyboard.slice(0, 8).map((row) => row.slice(0, 4).map((label) => ({ text: label.slice(0, 64) }))),
          resize_keyboard: true,
          is_persistent: true,
        }
      : input.removeKeyboard
        ? { remove_keyboard: true }
        : undefined;
  return telegramCall<{ message_id?: number }>(input.token, "sendMessage", {
    chat_id: input.chatId,
    text: safeText,
    disable_web_page_preview: true,
    ...(input.replyToMessageId ? { reply_parameters: { message_id: Number(input.replyToMessageId) } } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function editTelegramMessage(input: {
  token: string;
  chatId: string;
  messageId: number;
  text: string;
  buttonRows?: TelegramInlineButton[][];
}) {
  const text = input.text.trim();
  if (!text) throw new ApiError(500, "TELEGRAM_EMPTY_MESSAGE", "تم منع تعديل رسالة Telegram إلى نص فارغ.");
  const rows = input.buttonRows?.slice(0, 8).map((row) => row.slice(0, 4).map((button) => ({
    text: button.title.slice(0, 64),
    ...(button.url ? { url: button.url } : { callback_data: (button.id ?? "nav:home").slice(0, 64) }),
  })));
  return telegramCall<boolean | { message_id?: number }>(input.token, "editMessageText", {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: text.slice(0, 4096),
    disable_web_page_preview: true,
    ...(rows?.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  });
}

export function answerTelegramCallback(input: {
  token: string;
  callbackQueryId: string;
  text?: string;
}) {
  return telegramCall<boolean>(input.token, "answerCallbackQuery", {
    callback_query_id: input.callbackQueryId,
    ...(input.text ? { text: input.text.slice(0, 180) } : {}),
  });
}

export function sendTelegramChatAction(input: {
  token: string;
  chatId: string;
  action: "typing" | "upload_document" | "upload_photo" | "record_voice" | "upload_video";
}) {
  return telegramCall<boolean>(input.token, "sendChatAction", {
    chat_id: input.chatId,
    action: input.action,
  });
}

export function getTelegramFile(input: { token: string; fileId: string }) {
  return telegramCall<{ file_id: string; file_size?: number; file_path?: string }>(input.token, "getFile", {
    file_id: input.fileId,
  });
}

export async function downloadTelegramFile(token: string, fileId: string): Promise<{
  content: Buffer;
  filePath: string;
}> {
  const metadata = await getTelegramFile({ token, fileId });
  if (!metadata.file_path || metadata.file_path.includes("..") || metadata.file_path.startsWith("/")) {
    throw new ApiError(502, "TELEGRAM_FILE_INVALID", "تعذر تحديد ملف Telegram.");
  }
  if (metadata.file_size !== undefined && metadata.file_size > 20 * 1024 * 1024) {
    throw new ApiError(413, "FILE_TOO_LARGE", "حجم الملف يتجاوز 20 ميجابايت.");
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
