import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, whatsappConnections } from "@/db/schema";
import { maskEmail } from "@/lib/integrations/whatsapp/crypto";
import { disconnectWhatsAppByWaId } from "@/lib/integrations/whatsapp/linking";
import { finishWhatsAppFlow, startWhatsAppFlow } from "./session-service";
import { sendWhatsAppButtons, sendWhatsAppText } from "./message-renderer";
import type { WhatsAppRuntimeContext } from "./types";

export async function showWhatsAppAccount(context: WhatsAppRuntimeContext) {
  const [[organization], [connection]] = await Promise.all([
    db().select({ name: organizations.name }).from(organizations)
      .where(eq(organizations.id, context.identity.organizationId)).limit(1),
    db().select({
      connectedAt: whatsappConnections.connectedAt,
      lastInteractionAt: whatsappConnections.lastInteractionAt,
      phoneNumberMasked: whatsappConnections.whatsappPhoneNumberMasked,
    }).from(whatsappConnections).where(and(
      eq(whatsappConnections.userId, context.identity.userId),
      eq(whatsappConnections.organizationId, context.identity.organizationId),
      eq(whatsappConnections.connectionStatus, "connected"),
    )).limit(1),
  ]);

  await sendWhatsAppText({
    to: context.message.from,
    text: [
      "حساب منصة معتز",
      `الاسم: ${context.identity.name?.trim() || "غير محدد"}`,
      `البريد: ${maskEmail(context.identity.email)}`,
      `المؤسسة: ${organization?.name?.trim() || "غير محددة"}`,
      `الدور: ${context.identity.role}`,
      `رقم WhatsApp: ${connection?.phoneNumberMasked || "مرتبط"}`,
      `تاريخ الربط: ${connection?.connectedAt?.toLocaleString("ar-SA") || "غير متاح"}`,
      `آخر نشاط: ${connection?.lastInteractionAt?.toLocaleString("ar-SA") || "غير متاح"}`,
      `الوكيل المختار: ${context.session.selectedAgentId ? "محدد" : "غير محدد"}`,
      `المحادثة النشطة: ${context.session.selectedConversationId ? "موجودة" : "غير موجودة"}`,
    ].join("\n"),
  });
}

export async function requestWhatsAppDisconnect(context: WhatsAppRuntimeContext) {
  const session = await startWhatsAppFlow({
    session: context.session,
    flow: "account.disconnect",
    step: "confirm",
  });
  await sendWhatsAppButtons({
    to: context.message.from,
    text: "سيؤدي فصل الحساب إلى إيقاف وصول WhatsApp إلى بيانات المنصة حتى إعادة الربط. هل تؤكد؟",
    actions: [
      { id: "wa.disconnect.confirm", title: "تأكيد الفصل" },
      { id: "wa.cancel", title: "إلغاء" },
    ],
  });
  return session;
}

export async function confirmWhatsAppDisconnect(context: WhatsAppRuntimeContext) {
  if (context.session.activeFlow !== "account.disconnect" || context.session.currentStep !== "confirm") {
    await sendWhatsAppText({ to: context.message.from, text: "لا توجد عملية فصل معلقة تحتاج إلى تأكيد." });
    return;
  }
  const result = await disconnectWhatsAppByWaId({
    waId: context.message.from,
    messageId: context.message.id,
  });
  await finishWhatsAppFlow({ session: context.session });
  await sendWhatsAppText({
    to: context.message.from,
    text: result.disconnected
      ? "تم فصل حساب WhatsApp عن منصة معتز."
      : "لا يوجد ارتباط نشط لهذا الرقم.",
  });
}
