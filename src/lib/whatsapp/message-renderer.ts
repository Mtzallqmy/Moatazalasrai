import {
  markMessageAsRead,
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextMessage,
} from "@/lib/integrations/whatsapp/client";

const MAX_TEXT_LENGTH = 4096;
const SAFE_CHUNK_LENGTH = 3900;
const ACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type WhatsAppAction = {
  id: string;
  title: string;
  description?: string;
};

export class WhatsAppRenderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "WhatsAppRenderError";
  }
}

export function requireWhatsAppText(value: unknown, fallback?: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text) return text;
  const safeFallback = fallback?.trim();
  if (safeFallback) return safeFallback;
  throw new WhatsAppRenderError("WHATSAPP_EMPTY_TEXT", "رفض Renderer إرسال رسالة WhatsApp فارغة.");
}

export function splitWhatsAppText(value: unknown) {
  const text = requireWhatsAppText(value);
  if (text.length <= MAX_TEXT_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > SAFE_CHUNK_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", SAFE_CHUNK_LENGTH);
    if (splitAt < SAFE_CHUNK_LENGTH / 2) splitAt = remaining.lastIndexOf(" ", SAFE_CHUNK_LENGTH);
    if (splitAt < SAFE_CHUNK_LENGTH / 2) splitAt = SAFE_CHUNK_LENGTH;
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  if (!chunks.length) throw new WhatsAppRenderError("WHATSAPP_EMPTY_TEXT", "تعذر تقسيم نص WhatsApp.");
  return chunks;
}

function normalizeActions(actions: readonly WhatsAppAction[], maximum: number) {
  if (!actions.length || actions.length > maximum) {
    throw new WhatsAppRenderError("WHATSAPP_ACTION_COUNT_INVALID", `عدد الإجراءات يجب أن يكون بين 1 و${maximum}.`);
  }
  return actions.map((action) => {
    const id = action.id.trim();
    const title = action.title.trim();
    if (!ACTION_ID_PATTERN.test(id)) {
      throw new WhatsAppRenderError("WHATSAPP_ACTION_ID_INVALID", "معرّف إجراء WhatsApp غير صالح.");
    }
    if (!title) throw new WhatsAppRenderError("WHATSAPP_ACTION_TITLE_EMPTY", "عنوان إجراء WhatsApp فارغ.");
    return { id, title, ...(action.description?.trim() ? { description: action.description.trim() } : {}) };
  });
}

export async function sendWhatsAppText(input: {
  to: string;
  text: unknown;
  previewUrl?: boolean;
  replyToMessageId?: string;
}) {
  const chunks = splitWhatsAppText(input.text);
  const messageIds: string[] = [];
  for (const [index, text] of chunks.entries()) {
    const sent = await sendTextMessage({
      to: input.to,
      text,
      previewUrl: input.previewUrl,
      replyToMessageId: index === 0 ? input.replyToMessageId : undefined,
    });
    messageIds.push(sent.messageId);
  }
  return { messageIds, messageId: messageIds.at(-1)! };
}

export function sendWhatsAppButtons(input: {
  to: string;
  text: unknown;
  actions: readonly WhatsAppAction[];
  footerText?: string;
}) {
  const actions = normalizeActions(input.actions, 3).map(({ id, title }) => ({
    id,
    title: title.slice(0, 20),
  }));
  return sendInteractiveButtons({
    to: input.to,
    bodyText: requireWhatsAppText(input.text).slice(0, 1024),
    footerText: input.footerText?.trim().slice(0, 60),
    buttons: actions,
  });
}

export function sendWhatsAppList(input: {
  to: string;
  text: unknown;
  title: string;
  buttonText?: string;
  actions: readonly WhatsAppAction[];
}) {
  const actions = normalizeActions(input.actions, 10).map((action) => ({
    id: action.id,
    title: action.title.slice(0, 24),
    ...(action.description ? { description: action.description.slice(0, 72) } : {}),
  }));
  return sendInteractiveList({
    to: input.to,
    bodyText: requireWhatsAppText(input.text).slice(0, 1024),
    buttonText: requireWhatsAppText(input.buttonText, "فتح القائمة").slice(0, 20),
    title: requireWhatsAppText(input.title).slice(0, 24),
    actions,
  });
}

export function sendWhatsAppMenu(input: {
  to: string;
  text: unknown;
  title: string;
  actions: readonly WhatsAppAction[];
}) {
  if (input.actions.length <= 3) {
    return sendWhatsAppButtons({ to: input.to, text: input.text, actions: input.actions });
  }
  return sendWhatsAppList({
    to: input.to,
    text: input.text,
    title: input.title,
    actions: input.actions.slice(0, 10),
  });
}

export function sendWhatsAppError(input: { to: string; text: unknown; referenceId?: string }) {
  const reference = input.referenceId?.trim();
  const text = requireWhatsAppText(input.text, "تعذر إكمال الطلب حاليًا.");
  return sendWhatsAppText({
    to: input.to,
    text: reference ? `${text}\nالمرجع: ${reference.slice(0, 80)}` : text,
  });
}

export function sendWhatsAppEmptyState(input: {
  to: string;
  reason: unknown;
  action?: WhatsAppAction;
}) {
  const reason = requireWhatsAppText(input.reason, "لا توجد بيانات متاحة حاليًا.");
  return input.action
    ? sendWhatsAppButtons({ to: input.to, text: reason, actions: [input.action] })
    : sendWhatsAppText({ to: input.to, text: reason });
}

export function answerWhatsAppMessage(messageId: string) {
  const id = messageId.trim();
  if (!id) throw new WhatsAppRenderError("WHATSAPP_MESSAGE_ID_EMPTY", "معرّف الرسالة فارغ.");
  return markMessageAsRead({ messageId: id });
}
