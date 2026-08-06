import { ApiError } from "@/lib/http/api";
import {
  telegramAnswerCallback,
  telegramChatAction,
  telegramSend,
  telegramSendDocument as sendDocumentApi,
  type TelegramButton,
} from "@/lib/telegram/client";

const TEXT_LIMIT = 3900;
const CALLBACK_LIMIT = 64;

function requiredText(value: unknown, code = "TELEGRAM_EMPTY_TEXT") {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(500, code, "تعذر إنشاء محتوى صالح للرسالة.");
  }
  return value.trim().replace(/\b(?:undefined|null)\b/giu, "—");
}

export function validateTelegramButtons(rows: TelegramButton[][] | undefined) {
  if (!rows) return undefined;
  return rows.filter((row) => row.length > 0).slice(0, 8).map((row) => row.slice(0, 4).map((button) => {
    const title = requiredText(button.title, "TELEGRAM_EMPTY_BUTTON").slice(0, 64);
    if (button.url) return { title, url: button.url };
    const id = requiredText(button.id, "TELEGRAM_CALLBACK_REQUIRED");
    if (Buffer.byteLength(id, "utf8") > CALLBACK_LIMIT) {
      throw new ApiError(500, "TELEGRAM_CALLBACK_TOO_LONG", "معرّف الإجراء يتجاوز حد Telegram.");
    }
    return { title, id };
  }));
}

export function splitTelegramText(value: string) {
  const text = requiredText(value);
  if (text.length <= TEXT_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TEXT_LIMIT) {
    const window = remaining.slice(0, TEXT_LIMIT);
    const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const index = breakAt > TEXT_LIMIT * 0.55 ? breakAt : TEXT_LIMIT;
    chunks.push(requiredText(remaining.slice(0, index)));
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) chunks.push(requiredText(remaining));
  return chunks;
}

export async function sendTelegramText(input: {
  chatId: string;
  text: string;
  buttonRows?: TelegramButton[][];
}) {
  const chunks = splitTelegramText(input.text);
  const buttons = validateTelegramButtons(input.buttonRows);
  let last: Awaited<ReturnType<typeof telegramSend>> | null = null;
  for (const [index, chunk] of chunks.entries()) {
    last = await telegramSend({
      chatId: input.chatId,
      text: chunk,
      buttonRows: index === chunks.length - 1 ? buttons : undefined,
    });
  }
  return last;
}

export async function editTelegramText(input: {
  chatId: string;
  messageId: string;
  text: string;
  buttonRows?: TelegramButton[][];
}) {
  const chunks = splitTelegramText(input.text);
  const buttons = validateTelegramButtons(input.buttonRows);
  try {
    await telegramSend({
      chatId: input.chatId,
      messageId: input.messageId,
      text: chunks[0]!,
      buttonRows: chunks.length === 1 ? buttons : undefined,
    });
    for (let index = 1; index < chunks.length; index += 1) {
      await telegramSend({
        chatId: input.chatId,
        text: chunks[index]!,
        buttonRows: index === chunks.length - 1 ? buttons : undefined,
      });
    }
  } catch {
    return sendTelegramText({ chatId: input.chatId, text: input.text, buttonRows: buttons });
  }
}

export function sendTelegramMenu(input: {
  chatId: string;
  title: string;
  path?: string;
  description?: string;
  buttonRows: TelegramButton[][];
  messageId?: string;
}) {
  const text = [input.path, input.title, input.description].filter((value): value is string => Boolean(value?.trim())).join("\n\n");
  return input.messageId
    ? editTelegramText({ chatId: input.chatId, messageId: input.messageId, text, buttonRows: input.buttonRows })
    : sendTelegramText({ chatId: input.chatId, text, buttonRows: input.buttonRows });
}

export function sendTelegramList(input: {
  chatId: string;
  title: string;
  path?: string;
  items: string[];
  buttonRows?: TelegramButton[][];
  messageId?: string;
  emptyText?: string;
}) {
  if (input.items.length === 0) {
    return sendTelegramEmptyState({
      chatId: input.chatId,
      title: input.title,
      text: input.emptyText ?? "لا توجد عناصر متاحة حاليًا.",
      buttonRows: input.buttonRows,
      messageId: input.messageId,
    });
  }
  const text = [input.path, input.title, input.items.join("\n\n")].filter(Boolean).join("\n\n");
  return input.messageId
    ? editTelegramText({ chatId: input.chatId, messageId: input.messageId, text, buttonRows: input.buttonRows })
    : sendTelegramText({ chatId: input.chatId, text, buttonRows: input.buttonRows });
}

export function sendTelegramError(input: {
  chatId: string;
  text: string;
  referenceId?: string;
  buttonRows?: TelegramButton[][];
  messageId?: string;
}) {
  const text = `${requiredText(input.text)}${input.referenceId ? `\n\nمرجع المتابعة: ${input.referenceId}` : ""}`;
  return input.messageId
    ? editTelegramText({ chatId: input.chatId, messageId: input.messageId, text, buttonRows: input.buttonRows })
    : sendTelegramText({ chatId: input.chatId, text, buttonRows: input.buttonRows });
}

export function sendTelegramEmptyState(input: {
  chatId: string;
  title: string;
  text: string;
  buttonRows?: TelegramButton[][];
  messageId?: string;
}) {
  const text = `${requiredText(input.title)}\n\n${requiredText(input.text)}`;
  return input.messageId
    ? editTelegramText({ chatId: input.chatId, messageId: input.messageId, text, buttonRows: input.buttonRows })
    : sendTelegramText({ chatId: input.chatId, text, buttonRows: input.buttonRows });
}

export function sendTelegramDocument(input: {
  chatId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
  caption?: string;
}) {
  if (!input.content.length) throw new ApiError(500, "TELEGRAM_EMPTY_DOCUMENT", "الملف فارغ ولا يمكن إرساله.");
  return sendDocumentApi({
    ...input,
    filename: requiredText(input.filename, "TELEGRAM_FILENAME_REQUIRED"),
    mimeType: requiredText(input.mimeType, "TELEGRAM_MIME_REQUIRED"),
    caption: input.caption?.trim() || undefined,
  });
}

export function answerTelegramCallback(input: { callbackId: string; text?: string }) {
  return telegramAnswerCallback({ callbackId: requiredText(input.callbackId), text: input.text?.trim() || undefined });
}

export function sendTelegramTyping(chatId: string) {
  return telegramChatAction({ chatId, action: "typing" });
}
