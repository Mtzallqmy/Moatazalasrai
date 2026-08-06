import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformModules } from "@/db/control-plane-schema";
import { userHasPermission } from "@/lib/auth/user-authorization";
import type { Permission } from "@/lib/auth/permissions";
import type { ChannelClientIdentity } from "./types";

export type ChannelCapability = {
  id: string;
  labelAr: string;
  descriptionAr: string;
  icon?: string;
  requiredPermission?: Permission;
  telegramFeatureKey?: string;
  whatsappFeatureKey?: string;
  requiredPlatformModule?: string;
  fallbackDashboardUrl?: string;
  supportsPagination: boolean;
  destructive: boolean;
  adminOnly: boolean;
  actionId: string;
};

export const CHANNEL_CAPABILITY_REGISTRY: readonly ChannelCapability[] = Object.freeze([
  {
    id: "chat.start",
    labelAr: "محادثة مباشرة",
    descriptionAr: "اختيار وكيل منشور وبدء محادثة حقيقية محفوظة في المنصة.",
    icon: "💬",
    requiredPermission: "agents:run",
    telegramFeatureKey: "telegram.chat",
    whatsappFeatureKey: "whatsapp.chat",
    fallbackDashboardUrl: "/dashboard/chat",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
    actionId: "cc.chat",
  },
  {
    id: "agents.list",
    labelAr: "الوكلاء",
    descriptionAr: "عرض الوكلاء الحقيقيين المتاحين وحالتهم ومزودهم ونموذجهم.",
    icon: "🤖",
    requiredPermission: "agents:read",
    telegramFeatureKey: "telegram.agents",
    whatsappFeatureKey: "whatsapp.agents",
    fallbackDashboardUrl: "/dashboard/agents",
    supportsPagination: true,
    destructive: false,
    adminOnly: false,
    actionId: "cc.agents:1",
  },
  {
    id: "agents.create",
    labelAr: "إنشاء وكيل",
    descriptionAr: "إنشاء وكيل فعلي بعد اختيار مزود ونموذج متحققين.",
    icon: "➕",
    requiredPermission: "agents:manage",
    telegramFeatureKey: "telegram.admin_commands",
    whatsappFeatureKey: "whatsapp.admin_commands",
    fallbackDashboardUrl: "/dashboard/agents",
    supportsPagination: false,
    destructive: false,
    adminOnly: true,
    actionId: "cc.agent.create",
  },
  {
    id: "files.receive",
    labelAr: "الملفات والوسائط",
    descriptionAr: "إرسال ملف أو صورة أو صوت أو فيديو إلى المحادثة النشطة.",
    icon: "📎",
    requiredPermission: "files:upload",
    telegramFeatureKey: "telegram.files",
    whatsappFeatureKey: "whatsapp.files",
    fallbackDashboardUrl: "/dashboard/files",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
    actionId: "cc.files",
  },
  {
    id: "account.status",
    labelAr: "الحساب والجلسة",
    descriptionAr: "عرض المؤسسة والدور والوكيل والمحادثة النشطين.",
    icon: "👤",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
    actionId: "cc.account",
  },
]);

async function moduleEnabled(organizationId: string, key: string) {
  const [row] = await db().select({ status: platformModules.status }).from(platformModules).where(and(
    eq(platformModules.organizationId, organizationId),
    eq(platformModules.key, key),
  )).limit(1);
  return row?.status === "active";
}

export async function resolveChannelCapabilities(input: {
  identity: ChannelClientIdentity;
  featureAllowed(featureKey: string): Promise<boolean>;
}) {
  const visible: ChannelCapability[] = [];
  for (const capability of CHANNEL_CAPABILITY_REGISTRY) {
    if (capability.requiredPermission) {
      const permission = await userHasPermission({
        userId: input.identity.userId,
        organizationId: input.identity.organizationId,
        permission: capability.requiredPermission,
      });
      if (!permission.allowed) continue;
      if (capability.adminOnly && !["owner", "admin"].includes(permission.role)) continue;
    }
    const featureKey = input.identity.channel === "telegram"
      ? capability.telegramFeatureKey
      : capability.whatsappFeatureKey;
    if (featureKey && !await input.featureAllowed(featureKey)) continue;
    if (capability.requiredPlatformModule && !await moduleEnabled(input.identity.organizationId, capability.requiredPlatformModule)) continue;
    visible.push(capability);
  }
  return visible;
}
