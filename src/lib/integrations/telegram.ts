// Telegram Bot API client used by the shared channel adapter and legacy integrations.
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
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

export function sendTelegramMessage(input: {
  token: string;
  chatId: string;
  text: string;
  replyToMessageId?: string;
  buttons?: Array<{ id: string; title: string }>;
}) {
  const text = input.text.length > 4000 ? `${input.text.slice(0, 3990)}…` : input.text;
  return telegramCall<{ message_id?: number }>(input.token, "sendMessage", {
    chat_id: input.chatId,
    text,
    disable_web_page_preview: true,
    ...(input.replyToMessageId ? { reply_parameters: { message_id: Number(input.replyToMessageId) } } : {}),
    ...(input.buttons?.length ? {
      reply_markup: {
        inline_keyboard: input.buttons.slice(0, 12).map((button) => [{
          text: button.title.slice(0, 64),
          callback_data: button.id.slice(0, 64),
        }]),
      },
    } : {}),
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
