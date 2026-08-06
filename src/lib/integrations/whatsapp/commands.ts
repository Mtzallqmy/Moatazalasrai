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
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import {
  channelPolicyForWhatsApp,
  connectionForWhatsAppPolicy,
  ensureOrganizationWhatsAppProjection,
  resolveEffectiveWhatsAppPolicy,
  withWhatsAppChannelPolicy,
} from "@/lib/channels/whatsapp-platform";

export const WHATSAPP_COMMAND_IDS = Object.freeze({
  account: "wa.account",
  openChat: "wa.open_chat",
  status: "wa.status",
  disconnect: "wa.disconnect",
  menu: "wa.menu",
});

type ParsedCommand =
  | { kind: "connect"; token: string }
  | { kind: "account" | "open_chat" | "status" | "disconnect" | "menu" | "unknown" };

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
  if (id === WHATSAPP_COMMAND_IDS.status) return { kind: "status" };
  if (id === WHATSAPP_COMMAND_IDS.disconnect) return { kind: "disconnect" };
  if (id === WHATSAPP_COMMAND_IDS.menu) return { kind: "menu" };

  const normalized = text.toLowerCase();
  if (["القائمة", "قائمة", "مساعدة", "الأوامر", "الاوامر", "help", "/help", "menu", "/menu", "ابدأ", "/start"].includes(normalized)) return { kind: "menu" };
  if (["حسابي", "الحساب", "/account"].includes(normalized)) return { kind: "account" };
  if (["الحالة", "حالة الوكيل", "الإعدادات", "الاعدادات", "status", "/status"].includes(normalized)) return { kind: "status" };
  if (["فتح الدردشة", "الدردشة", "محادثة جديدة", "جديد", "/chat", "/new"].includes(normalized)) return { kind: "open_chat" };
  if (["إلغاء الربط", "الغاء الربط", "فصل الحساب", "/disconnect"].includes(normalized)) return { kind: "disconnect" };
  return { kind: "unknown" };
}

export function sendWhatsAppMainMenu(to: string) {
  return sendInteractiveButtons({
    to,
    bodyText: [
      "اختر خدمة من منصة معتز.",
      "زر «محادثة جديدة» ينشئ محادثة فعلية داخل المنصة ويربطها بالوكيل والمزود والنموذج والأدوات المحددة في السياسة.",
      "الأوامر النصية: القائمة، حسابي، الحالة، محادثة جديدة، إلغاء الربط.",
      "لا ننفذ تغييرات حساسة أو مالية من WhatsApp.",
    ].join("\n"),
    footerText: "للمساعدة اكتب: القائمة",
    buttons: [
      { id: WHATSAPP_COMMAND_IDS.account, title: "حسابي" },
      { id: WHATSAPP_COMMAND_IDS.status, title: "حالة الوكيل" },
      { id: WHATSAPP_COMMAND_IDS.openChat, title: "محادثة جديدة" },
    ],
  });
}

async function invalidConnectReply(to: string) {
  await sendTextMessage({ to, text: "رمز الربط غير صالح أو انتهت صلاحيته. ارجع إلى الموقع وأنشئ رابطًا جديدًا." });
}

async function startRealChannelConversation(input: {
  message: WhatsAppIncomingMessage;
  organizationId: string;
  userId: string;
  name?: string | null;
}) {
  const policy = await resolveEffectiveWhatsAppPolicy({
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (policy.status === "disabled" || !policy.autoReplyEnabled) {
    await sendTextMessage({ to: input.message.from, text: "الدردشة الآلية معطلة في سياسة WhatsApp الحالية." });
    return;
  }
  if (!policy.agentId) {
    await sendTextMessage({ to: input.message.from, text: "لم يتم تخصيص وكيل لقناة WhatsApp. اختر الوكيل والمزود والنموذج من لوحة القنوات أولًا." });
    return;
  }
  const baseConnection = await ensureOrganizationWhatsAppProjection(input.organizationId);
  const connection = connectionForWhatsAppPolicy(baseConnection, policy);
  const routingPolicy = channelPolicyForWhatsApp(connection.id, policy);
  await withWhatsAppChannelPolicy({
    organizationId: connection.organizationId,
    connectionId: connection.id,
    routingPolicy,
  }, () => routeIncomingChannelMessage({
    connection,
    incoming: {
      eventId: `${input.message.id}:new`,
      externalAccountId: connection.externalAccountId,
      conversationExternalId: input.message.from,
      senderExternalId: input.message.from,
      senderDisplayName: input.name?.trim() || undefined,
      text: "/new",
      messageType: "interactive",
      interactiveActionId: "channel.new",
      attachments: [],
      receivedAt: new Date(),
    },
  }));
}

export async function processWhatsAppMessage(message: WhatsAppIncomingMessage) {
  const command = parseWhatsAppCommand(message);
  await markMessageAsRead({ messageId: message.id }).catch(() => undefined);

  if (command.kind === "connect") {
    const result = await consumeWhatsAppConnectToken({ token: command.token, waId: message.from, messageId: message.id });
    if (!result.ok) {
      await invalidConnectReply(message.from);
      return;
    }
    await sendTextMessage({ to: message.from, text: "✅ تم ربط حساب WhatsApp بحسابك في منصة معتز بنجاح." });
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
      text: ["حسابك مرتبط بنجاح.", `الاسم: ${user.name?.trim() || "غير محدد"}`, `البريد: ${maskEmail(user.email)}`, "لأي تعديل حساس افتح الموقع وسجّل الدخول من جديد."].join("\n"),
    });
    return;
  }

  if (command.kind === "status") {
    if (!user.organizationId) {
      await sendTextMessage({ to: message.from, text: "الحساب مرتبط، لكن لم تُحدد مؤسسة نشطة. اختر المؤسسة من الموقع ثم أعد الربط." });
      return;
    }
    const policy = await resolveEffectiveWhatsAppPolicy({ organizationId: user.organizationId, userId: user.userId });
    await sendTextMessage({
      to: message.from,
      text: [
        "حالة WhatsApp:",
        `الرد الآلي: ${policy.autoReplyEnabled && policy.status === "active" ? "مفعل" : "معطل"}`,
        `الوكيل: ${policy.agentId ? "محدد ومرتبط" : "غير محدد"}`,
        `المزود: ${policy.providerCredentialId ? "محدد ومتحقق" : "غير محدد"}`,
        `النموذج: ${policy.modelId || "غير محدد"}`,
        `الأدوات المسموحة: ${policy.allowedTools.length}`,
        `التحويل البشري: ${policy.forceHumanHandoff ? "إجباري" : policy.humanHandoffEnabled ? "متاح" : "معطل"}`,
        "أي رسالة عادية بعد إنشاء المحادثة تُرسل مباشرة إلى الوكيل وتُحفظ في دردشات المنصة.",
      ].join("\n"),
    });
    return;
  }

  if (command.kind === "open_chat") {
    if (!user.organizationId) {
      await sendTextMessage({ to: message.from, text: "اختر مؤسسة نشطة من الموقع ثم أعد ربط WhatsApp." });
      return;
    }
    try {
      await startRealChannelConversation({
        message,
        organizationId: user.organizationId,
        userId: user.userId,
        name: user.name,
      });
    } catch {
      await sendTextMessage({
        to: message.from,
        text: "تعذر إنشاء محادثة الوكيل. تحقق من أن الوكيل منشور، والمزود متحقق، والنموذج والأدوات مسموحة في سياسة WhatsApp.",
      });
    }
    return;
  }

  if (command.kind === "disconnect") {
    const result = await disconnectWhatsAppByWaId({ waId: message.from, messageId: message.id });
    await sendTextMessage({
      to: message.from,
      text: result.disconnected ? "تم إلغاء ربط WhatsApp. لن تصل معلومات الحساب عبر هذا الرقم قبل إعادة الربط." : "لا يوجد ارتباط نشط لهذا الرقم.",
    });
    return;
  }

  await sendWhatsAppMainMenu(message.from);
}
