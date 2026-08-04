import {
  connectedWhatsAppUser,
  consumeWhatsAppConnectToken,
  disconnectWhatsAppByWaId,
  parseConnectToken,
  touchWhatsAppInteraction,
} from "./linking";
import { maskEmail } from "./crypto";
import { markMessageAsRead, sendInteractiveButtons, sendTextMessage } from "./client";
import { requireWhatsAppConfig } from "./config";
import type { WhatsAppIncomingMessage } from "./webhook";

export const WHATSAPP_COMMAND_IDS = Object.freeze({
  account: "wa.account",
  openChat: "wa.open_chat",
  disconnect: "wa.disconnect",
  menu: "wa.menu",
});

type ParsedCommand =
  | { kind: "connect"; token: string }
  | { kind: "account" | "open_chat" | "disconnect" | "menu" | "unknown" };

function interactiveId(message: WhatsAppIncomingMessage) {
  return message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? null;
}

export function parseWhatsAppCommand(message: WhatsAppIncomingMessage): ParsedCommand {
  const text = message.type === "text" ? message.text?.body?.trim() ?? "" : "";
  const token = parseConnectToken(text);
  if (token) return { kind: "connect", token };

  const id = interactiveId(message);
  if (id === WHATSAPP_COMMAND_IDS.account) return { kind: "account" };
  if (id === WHATSAPP_COMMAND_IDS.openChat) return { kind: "open_chat" };
  if (id === WHATSAPP_COMMAND_IDS.disconnect) return { kind: "disconnect" };
  if (id === WHATSAPP_COMMAND_IDS.menu) return { kind: "menu" };

  const normalized = text.toLowerCase();
  if (["القائمة", "قائمة", "menu", "/menu", "ابدأ", "/start"].includes(normalized)) return { kind: "menu" };
  if (["حسابي", "الحساب"].includes(normalized)) return { kind: "account" };
  if (["إلغاء الربط", "الغاء الربط", "فصل الحساب"].includes(normalized)) return { kind: "disconnect" };
  return { kind: "unknown" };
}

export function sendWhatsAppMainMenu(to: string) {
  return sendInteractiveButtons({
    to,
    bodyText: "اختر خدمة من منصة معتز. لا ننفذ تغييرات حساسة أو مالية من WhatsApp.",
    footerText: "للقائمة اكتب: القائمة",
    buttons: [
      { id: WHATSAPP_COMMAND_IDS.account, title: "حسابي" },
      { id: WHATSAPP_COMMAND_IDS.openChat, title: "فتح الدردشة" },
      { id: WHATSAPP_COMMAND_IDS.disconnect, title: "إلغاء الربط" },
    ],
  });
}

async function invalidConnectReply(to: string) {
  await sendTextMessage({
    to,
    text: "رمز الربط غير صالح أو انتهت صلاحيته. ارجع إلى الموقع وأنشئ رابطًا جديدًا.",
  });
}

export async function processWhatsAppMessage(message: WhatsAppIncomingMessage) {
  const command = parseWhatsAppCommand(message);
  await markMessageAsRead({ messageId: message.id }).catch(() => undefined);

  if (command.kind === "connect") {
    const result = await consumeWhatsAppConnectToken({
      token: command.token,
      waId: message.from,
      messageId: message.id,
    });
    if (!result.ok) {
      await invalidConnectReply(message.from);
      return;
    }
    await sendTextMessage({
      to: message.from,
      text: "✅ تم ربط حساب WhatsApp بحسابك في منصة معتز بنجاح.",
    });
    await sendWhatsAppMainMenu(message.from);
    return;
  }

  const user = await connectedWhatsAppUser(message.from);
  if (!user) {
    const config = requireWhatsAppConfig();
    await sendTextMessage({
      to: message.from,
      text: `هذا الرقم غير مرتبط بحساب. افتح ${config.publicAppUrl}/dashboard/settings ثم اختر «ربط حسابي بواتساب».`,
      previewUrl: true,
    });
    return;
  }
  await touchWhatsAppInteraction(user.connectionId);

  if (command.kind === "account") {
    await sendTextMessage({
      to: message.from,
      text: [
        "حسابك مرتبط بنجاح.",
        `الاسم: ${user.name?.trim() || "غير محدد"}`,
        `البريد: ${maskEmail(user.email)}`,
        "لأي تعديل حساس افتح الموقع وسجّل الدخول من جديد.",
      ].join("\n"),
    });
    return;
  }

  if (command.kind === "open_chat") {
    const config = requireWhatsAppConfig();
    await sendTextMessage({
      to: message.from,
      text: `افتح دردشات المنصة من هذا الرابط:\n${config.publicAppUrl}/dashboard/chat\n\nستحتاج إلى جلسة تسجيل دخول صالحة.`,
      previewUrl: true,
    });
    return;
  }

  if (command.kind === "disconnect") {
    const result = await disconnectWhatsAppByWaId({ waId: message.from, messageId: message.id });
    await sendTextMessage({
      to: message.from,
      text: result.disconnected
        ? "تم إلغاء ربط WhatsApp. لن تصل أي معلومات للحساب عبر هذا الرقم قبل إعادة الربط."
        : "لا يوجد ارتباط نشط لهذا الرقم.",
    });
    return;
  }

  await sendWhatsAppMainMenu(message.from);
}
