import { parseConnectToken } from "@/lib/integrations/whatsapp/linking";
import type { WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";

export type ParsedWhatsAppUpdate =
  | { kind: "connect"; token: string }
  | { kind: "action"; actionId: string }
  | { kind: "text"; text: string }
  | { kind: "media" }
  | { kind: "unknown" };

function messageText(message: WhatsAppIncomingMessage) {
  if (message.type !== "text") return "";
  return message.text?.body?.trim() ?? "";
}

function interactiveId(message: WhatsAppIncomingMessage) {
  return message.interactive?.button_reply?.id
    ?? message.interactive?.list_reply?.id
    ?? "";
}

function commandAction(text: string) {
  const normalized = text.trim().toLocaleLowerCase("ar").replace(/^\//, "");
  const commands: Record<string, string> = {
    start: "wa.menu",
    ابدأ: "wa.menu",
    menu: "wa.menu",
    help: "wa.menu",
    القائمة: "wa.menu",
    قائمة: "wa.menu",
    مساعدة: "wa.menu",
    agents: "wa.agents",
    الوكلاء: "wa.agents",
    agent: "wa.agents",
    chat: "wa.chat",
    الدردشة: "wa.chat",
    "محادثة مباشرة": "wa.chat",
    conversations: "wa.conversations",
    المحادثات: "wa.conversations",
    files: "wa.files",
    الملفات: "wa.files",
    account: "wa.account",
    حسابي: "wa.account",
    الحساب: "wa.account",
    status: "wa.account",
    الحالة: "wa.account",
    disconnect: "wa.disconnect",
    "فصل الحساب": "wa.disconnect",
    "إلغاء الربط": "wa.disconnect",
    cancel: "wa.cancel",
    إلغاء: "wa.cancel",
    الغاء: "wa.cancel",
  };
  return commands[normalized] ?? null;
}

export function parseWhatsAppUpdate(message: WhatsAppIncomingMessage): ParsedWhatsAppUpdate {
  const actionId = interactiveId(message).trim();
  if (actionId) return { kind: "action", actionId };
  const text = messageText(message);
  if (text) {
    const token = parseConnectToken(text);
    if (token) return { kind: "connect", token };
    const action = commandAction(text);
    return action ? { kind: "action", actionId: action } : { kind: "text", text };
  }
  if (message.image?.id || message.document?.id || message.audio?.id || message.video?.id) {
    return { kind: "media" };
  }
  return { kind: "unknown" };
}
