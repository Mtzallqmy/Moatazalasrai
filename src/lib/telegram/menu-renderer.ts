import { visibleTelegramCapabilities, type TelegramCapabilitySection } from "@/lib/telegram/capability-registry";
import { sendTelegramEmptyState, sendTelegramMenu } from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";

const sections: Record<TelegramCapabilitySection, { label: string; description: string }> = {
  smart_work: { label: "العمل الذكي", description: "المحادثات والوكلاء والفرق والتشغيل." },
  content_knowledge: { label: "المحتوى والمعرفة", description: "الملفات وقواعد المعرفة والمحتوى." },
  channels_integrations: { label: "القنوات والتكاملات", description: "القنوات والمستودعات والمزودون." },
  operations: { label: "التشغيل", description: "الموافقات وMCP والمتصفح وبيئة التنفيذ." },
  administration: { label: "الإدارة", description: "الإشعارات والأعضاء والتدقيق والصحة والحساب." },
};

function messageId(context: TelegramActionContext) {
  return context.update.kind === "callback_query" ? context.update.messageId : undefined;
}

export async function renderTelegramHome(context: TelegramActionContext) {
  const capabilities = await visibleTelegramCapabilities(context);
  const visibleSections = (Object.keys(sections) as TelegramCapabilitySection[])
    .filter((section) => capabilities.some((capability) => capability.section === section));
  if (!visibleSections.length) {
    return sendTelegramEmptyState({
      chatId: context.update.chatId,
      messageId: messageId(context),
      title: "منصة معتز",
      text: "لا توجد قدرات Telegram مفعلة لحسابك في المؤسسة الحالية. راجع مسؤول المؤسسة.",
      buttonRows: [[{ title: "فتح إعدادات Telegram", url: `${context.dashboardUrl}/dashboard/integrations` }]],
    });
  }
  const activeFlow = context.session.activeFlow
    ? `لديك عملية نشطة: ${context.session.activeFlow} — الخطوة: ${context.session.currentStep ?? "غير محددة"}. لم يتم إلغاؤها.`
    : "اختر قسمًا. لن يظهر أي خيار إلا إذا كانت وحدته وصلاحياته وتنفيذه الخلفي متاحة.";
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية",
    title: "منصة معتز عبر Telegram",
    description: activeFlow,
    buttonRows: [
      ...visibleSections.map((section) => [{ id: `sec:${section}`, title: sections[section].label }]),
      ...(context.session.activeFlow ? [[{ id: "flow:resume", title: "متابعة العملية" }, { id: "flow:cancel:confirm", title: "إلغاء العملية" }]] : []),
      [{ id: "nav:home", title: "تحديث" }],
    ],
  });
}

export async function renderTelegramSection(context: TelegramActionContext, section: string) {
  if (!(section in sections)) return renderTelegramHome(context);
  const key = section as TelegramCapabilitySection;
  const capabilities = (await visibleTelegramCapabilities(context)).filter((capability) => capability.section === key);
  if (!capabilities.length) return renderTelegramHome(context);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: `الرئيسية ← ${sections[key].label}`,
    title: sections[key].label,
    description: sections[key].description,
    buttonRows: [
      ...capabilities.map((capability) => [{
        id: `cap:${capability.id}:1`,
        title: `${capability.icon ? `${capability.icon} ` : ""}${capability.labelAr}`.slice(0, 60),
      }]),
      [{ id: "nav:home", title: "رجوع إلى الرئيسية" }],
    ],
  });
}

export async function renderTelegramHelp(context: TelegramActionContext) {
  const capabilities = await visibleTelegramCapabilities(context);
  const lines = capabilities.map((capability) => `• ${capability.labelAr}: ${capability.descriptionAr}`);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← المساعدة",
    title: "الأوامر والقدرات المتاحة لحسابك",
    description: [
      "/start — فتح القائمة والحالة دون إلغاء العملية النشطة",
      "/help — عرض هذه المساعدة",
      "/status — فتح شاشة الحساب والجلسة",
      "/agents — عرض الوكلاء الحقيقيين",
      "/new — بدء أو اختيار محادثة حقيقية",
      "/files — عرض الملفات وتعليمات إرسالها داخل محادثة",
      "/cancel — إلغاء العملية النشطة بعد طلب الإلغاء",
      "/unlink — بدء تأكيد فصل الحساب",
      "",
      ...lines,
    ].join("\n"),
    buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
  });
}
