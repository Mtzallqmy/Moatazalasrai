import { sendWhatsAppEmptyState, sendWhatsAppList } from "./message-renderer";
import { visibleWhatsAppCapabilities } from "./capability-registry";
import type { WhatsAppCapability, WhatsAppRuntimeContext } from "./types";

const SECTION_LABELS: Record<WhatsAppCapability["section"], { label: string; description: string }> = {
  smart_work: { label: "العمل الذكي", description: "الدردشة والوكلاء والمحادثات" },
  knowledge: { label: "المحتوى والمعرفة", description: "الملفات والمعرفة والمحتوى" },
  integrations: { label: "القنوات والتكاملات", description: "التكاملات والمستودعات" },
  operations: { label: "التشغيل", description: "الموافقات والأدوات والمهام" },
  administration: { label: "الإدارة والحساب", description: "الحساب والصلاحيات والتشخيص" },
};

export async function sendWhatsAppMainMenu(context: WhatsAppRuntimeContext) {
  const capabilities = await visibleWhatsAppCapabilities(context);
  const sections = (["smart_work", "knowledge", "integrations", "operations", "administration"] as const)
    .filter((section) => capabilities.some((capability) => capability.section === section));
  if (!sections.length) {
    await sendWhatsAppEmptyState({
      to: context.message.from,
      reason: "لا توجد قدرات WhatsApp مفعلة لهذا الحساب. راجع مسؤول المؤسسة.",
    });
    return;
  }
  await sendWhatsAppList({
    to: context.message.from,
    text: "القائمة الرئيسية مبنية من الوحدات والصلاحيات والميزات المفعلة لحسابك.",
    title: "منصة معتز",
    buttonText: "فتح الأقسام",
    actions: sections.map((section) => ({
      id: `wa.section:${section}`,
      title: SECTION_LABELS[section].label,
      description: SECTION_LABELS[section].description,
    })),
  });
}

export async function sendWhatsAppSectionMenu(
  context: WhatsAppRuntimeContext,
  section: WhatsAppCapability["section"],
) {
  const capabilities = (await visibleWhatsAppCapabilities(context))
    .filter((capability) => capability.section === section);
  if (!capabilities.length) {
    await sendWhatsAppEmptyState({
      to: context.message.from,
      reason: "لم تعد هناك قدرات متاحة في هذا القسم بعد تحديث الصلاحيات.",
      action: { id: "wa.menu", title: "الرئيسية" },
    });
    return;
  }
  await sendWhatsAppList({
    to: context.message.from,
    text: `الرئيسية ← ${SECTION_LABELS[section].label}`,
    title: SECTION_LABELS[section].label,
    buttonText: "عرض الخيارات",
    actions: capabilities.map((capability) => ({
      id: `wa.cap:${capability.id}`,
      title: `${capability.icon ? `${capability.icon} ` : ""}${capability.labelAr}`,
      description: capability.descriptionAr,
    })),
  });
}
