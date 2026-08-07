import {
  answerTelegramCallback as answerCallback,
  sendTelegramMessage,
  type TelegramInlineButton,
} from "@/lib/integrations/telegram";

const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CALLBACK_LIMIT = 64;
const FALLBACK_TEXT = "لا توجد بيانات متاحة للعرض حاليًا.";

function normalizeText(value: unknown, fallback = FALLBACK_TEXT) {
  const text = typeof value === "string" ? value.replace(/\u0000/g, "").trim() : "";
  return text || fallback;
}

function splitText(value: string) {
  const text = normalizeText(value);
  if (text.length <= TELEGRAM_TEXT_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_TEXT_LIMIT) {
    let cut = remaining.lastIndexOf("\n", TELEGRAM_TEXT_LIMIT);
    if (cut < TELEGRAM_TEXT_LIMIT * 0.55) cut = remaining.lastIndexOf(" ", TELEGRAM_TEXT_LIMIT);
    if (cut < TELEGRAM_TEXT_LIMIT * 0.55) cut = TELEGRAM_TEXT_LIMIT;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function validateButtons(rows: TelegramInlineButton[][] | undefined) {
  return rows?.slice(0, 8).map((row) => row.slice(0, 4).filter((button) => {
    if (!button.title?.trim()) return false;
    if (button.id && Buffer.byteLength(button.id, "utf8") > TELEGRAM_CALLBACK_LIMIT) return false;
    return Boolean(button.id || button.url);
  })).filter((row) => row.length > 0);
}

export async function sendTelegramText(input: {
  token: string;
  chatId: string;
  text: unknown;
  buttonRows?: TelegramInlineButton[][];
}) {
  const chunks = splitText(normalizeText(input.text));
  for (let index = 0; index < chunks.length; index += 1) {
    await sendTelegramMessage({
      token: input.token,
      chatId: input.chatId,
      text: chunks[index],
      buttonRows: index === chunks.length - 1 ? validateButtons(input.buttonRows) : undefined,
    });
  }
}

export function sendTelegramMenu(input: {
  token: string;
  chatId: string;
  title: unknown;
  buttonRows: TelegramInlineButton[][];
}) {
  return sendTelegramText({ ...input, text: input.title, buttonRows: input.buttonRows });
}

export function sendTelegramList(input: {
  token: string;
  chatId: string;
  title: string;
  items: string[];
  emptyText: string;
  buttonRows?: TelegramInlineButton[][];
}) {
  const cleanItems = input.items.map((item) => item.trim()).filter(Boolean);
  const text = cleanItems.length
    ? `${normalizeText(input.title)}\n\n${cleanItems.join("\n")}`
    : normalizeText(input.emptyText);
  return sendTelegramText({ token: input.token, chatId: input.chatId, text, buttonRows: input.buttonRows });
}

export function sendTelegramError(input: {
  token: string;
  chatId: string;
  text: unknown;
  referenceId?: string;
  buttonRows?: TelegramInlineButton[][];
}) {
  const reference = input.referenceId ? `\n\nالمرجع: ${input.referenceId.slice(0, 24)}` : "";
  return sendTelegramText({ ...input, text: `${normalizeText(input.text, "تعذر إكمال الطلب حاليًا.")}${reference}` });
}

export function sendTelegramEmptyState(input: {
  token: string;
  chatId: string;
  reason: string;
  action?: string;
  buttonRows?: TelegramInlineButton[][];
}) {
  return sendTelegramText({
    ...input,
    text: [normalizeText(input.reason), input.action?.trim()].filter(Boolean).join("\n\n"),
  });
}

export async function answerTelegramCallback(input: {
  token: string;
  callbackQueryId: string;
  text?: string;
}) {
  await answerCallback({
    token: input.token,
    callbackQueryId: input.callbackQueryId,
    text: input.text?.trim().slice(0, 180),
  });
}
