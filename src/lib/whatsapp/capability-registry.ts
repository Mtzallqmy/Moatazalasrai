import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { platformModules } from "@/db/control-plane-schema";
import { listWhatsAppAgents, startWhatsAppAgentCreation } from "./agent-flows";
import { requestWhatsAppDisconnect, showWhatsAppAccount } from "./account-flows";
import { listWhatsAppConversations, openWhatsAppChat } from "./conversation-flows";
import { showWhatsAppFileInstructions } from "./file-flows";
import type { WhatsAppCapability, WhatsAppRuntimeContext } from "./types";

const ADMIN_ROLES = new Set(["owner", "admin"]);

export const WHATSAPP_CAPABILITIES: readonly WhatsAppCapability[] = [
  {
    id: "chat.open",
    section: "smart_work",
    labelAr: "محادثة مباشرة",
    descriptionAr: "اختيار وكيل منشور وبدء محادثة حقيقية.",
    icon: "💬",
    requiredPermission: "agents:run",
    whatsappFeatureKey: "ai.chat",
    requiredPlatformModule: "agents",
    handler: openWhatsAppChat,
    fallbackDashboardUrl: "/dashboard/chat",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "agents.list",
    section: "smart_work",
    labelAr: "الوكلاء",
    descriptionAr: "عرض الوكلاء الفعليين وحالاتهم ومزوديهم.",
    icon: "🤖",
    requiredPermission: "agents:read",
    whatsappFeatureKey: "agent.use",
    requiredPlatformModule: "agents",
    handler: (context) => listWhatsAppAgents(context, 0),
    fallbackDashboardUrl: "/dashboard/agents",
    supportsPagination: true,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "agents.create",
    section: "smart_work",
    labelAr: "إنشاء وكيل",
    descriptionAr: "إنشاء وكيل كامل عبر مزود ونموذج متحققين.",
    icon: "➕",
    requiredPermission: "agents:manage",
    whatsappFeatureKey: "agent.use",
    requiredPlatformModule: "agents",
    handler: startWhatsAppAgentCreation,
    fallbackDashboardUrl: "/dashboard/agents",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "conversations.list",
    section: "smart_work",
    labelAr: "المحادثات",
    descriptionAr: "عرض المحادثات الفعلية المتاحة للحساب.",
    icon: "🗂️",
    requiredPermission: "agents:run",
    whatsappFeatureKey: "conversation.open",
    requiredPlatformModule: "channels",
    handler: (context) => listWhatsAppConversations(context, 0),
    fallbackDashboardUrl: "/dashboard/chat",
    supportsPagination: true,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "files.upload",
    section: "knowledge",
    labelAr: "إرسال ملف",
    descriptionAr: "تخزين ملفات ووسائط حقيقية وربطها بالمحادثة.",
    icon: "📎",
    requiredPermission: "files:upload",
    whatsappFeatureKey: "files.use",
    requiredPlatformModule: "content",
    handler: showWhatsAppFileInstructions,
    fallbackDashboardUrl: "/dashboard/files",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "account.status",
    section: "administration",
    labelAr: "الحساب",
    descriptionAr: "عرض المستخدم والمؤسسة والربط والجلسة الحالية.",
    icon: "👤",
    requiredPermission: "channels:use",
    whatsappFeatureKey: "account.read",
    requiredPlatformModule: "channels",
    handler: showWhatsAppAccount,
    fallbackDashboardUrl: "/dashboard/settings",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "account.disconnect",
    section: "administration",
    labelAr: "فصل WhatsApp",
    descriptionAr: "فصل الحساب بعد تأكيد صريح.",
    icon: "🔒",
    requiredPermission: "channels:use",
    whatsappFeatureKey: "account.read",
    requiredPlatformModule: "channels",
    handler: requestWhatsAppDisconnect,
    fallbackDashboardUrl: "/dashboard/settings",
    supportsPagination: false,
    destructive: true,
    adminOnly: false,
  },
] as const;

async function moduleEnabled(context: WhatsAppRuntimeContext, key: string | undefined) {
  if (!key) return true;
  const [module] = await db().select({ status: platformModules.status }).from(platformModules).where(and(
    eq(platformModules.organizationId, context.identity.organizationId),
    eq(platformModules.key, key),
    isNull(platformModules.deletedAt),
  )).limit(1);
  return module?.status === "active";
}

export async function capabilityVisible(context: WhatsAppRuntimeContext, capability: WhatsAppCapability) {
  if (!context.identity.permissions.has(capability.requiredPermission)) return false;
  if (!context.identity.channelFeatures.has(capability.whatsappFeatureKey)) return false;
  if (capability.adminOnly && !ADMIN_ROLES.has(context.identity.role)) return false;
  if (!await moduleEnabled(context, capability.requiredPlatformModule)) return false;
  return capability.visibilityResolver ? capability.visibilityResolver(context) : true;
}

export async function visibleWhatsAppCapabilities(context: WhatsAppRuntimeContext) {
  const visibility = await Promise.all(WHATSAPP_CAPABILITIES.map(async (capability) => ({
    capability,
    visible: await capabilityVisible(context, capability),
  })));
  return visibility.filter((item) => item.visible).map((item) => item.capability);
}

export function whatsappCapability(id: string) {
  return WHATSAPP_CAPABILITIES.find((capability) => capability.id === id) ?? null;
}
