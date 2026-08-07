import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformModules } from "@/db/control-plane-schema";
import { organizationMembers } from "@/db/schema";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { telegramFeatureAllowed, type TelegramFeatureKey } from "@/lib/integrations/telegram-platform";

export type TelegramCapabilityId =
  | "chat.start"
  | "agents.list"
  | "agents.create"
  | "approvals.list"
  | "account.status";

export type TelegramCapability = {
  id: TelegramCapabilityId;
  labelAr: string;
  descriptionAr: string;
  icon?: string;
  requiredPermission: Permission;
  telegramFeatureKey: TelegramFeatureKey;
  requiredPlatformModule: string;
  fallbackDashboardUrl: string;
  supportsPagination: boolean;
  destructive: boolean;
  adminOnly: boolean;
};

export const TELEGRAM_CAPABILITIES: readonly TelegramCapability[] = [
  {
    id: "chat.start",
    labelAr: "محادثة مباشرة",
    descriptionAr: "بدء محادثة حقيقية مع وكيل منشور.",
    icon: "💬",
    requiredPermission: "agents:run",
    telegramFeatureKey: "telegram.chat",
    requiredPlatformModule: "agents",
    fallbackDashboardUrl: "/dashboard/chat",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "agents.list",
    labelAr: "الوكلاء",
    descriptionAr: "عرض الوكلاء الحقيقيين المتاحين في المؤسسة.",
    icon: "🤖",
    requiredPermission: "agents:read",
    telegramFeatureKey: "telegram.agents",
    requiredPlatformModule: "agents",
    fallbackDashboardUrl: "/dashboard/agents",
    supportsPagination: true,
    destructive: false,
    adminOnly: false,
  },
  {
    id: "agents.create",
    labelAr: "إنشاء وكيل جديد",
    descriptionAr: "إنشاء وكيل كامل باستخدام مزود ونموذج متحقق منهما.",
    icon: "➕",
    requiredPermission: "agents:manage",
    telegramFeatureKey: "telegram.agents",
    requiredPlatformModule: "agents",
    fallbackDashboardUrl: "/dashboard/agents",
    supportsPagination: false,
    destructive: false,
    adminOnly: true,
  },
  {
    id: "approvals.list",
    labelAr: "الموافقات",
    descriptionAr: "مراجعة طلبات الأدوات المعلقة واتخاذ قرار حقيقي.",
    icon: "✅",
    requiredPermission: "runs:read",
    telegramFeatureKey: "telegram.admin_commands",
    requiredPlatformModule: "security",
    fallbackDashboardUrl: "/dashboard/approvals",
    supportsPagination: false,
    destructive: true,
    adminOnly: true,
  },
  {
    id: "account.status",
    labelAr: "الحساب والحالة",
    descriptionAr: "عرض المؤسسة والدور والجلسة والميزات المسموحة.",
    icon: "👤",
    requiredPermission: "channels:use",
    telegramFeatureKey: "telegram.chat",
    requiredPlatformModule: "channels",
    fallbackDashboardUrl: "/dashboard/integrations",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
  },
] as const;

async function membershipContext(userId: string, organizationId: string) {
  const [membership] = await db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.organizationId, organizationId),
  )).limit(1);
  if (!membership) return null;
  const custom = await loadCustomPermissions(organizationId, userId);
  return { role: membership.role as Role, custom: new Set<Permission>(custom as Permission[]) };
}

async function moduleEnabled(organizationId: string, moduleKey: string) {
  const [module] = await db().select({ status: platformModules.status }).from(platformModules).where(and(
    eq(platformModules.organizationId, organizationId),
    eq(platformModules.key, moduleKey),
  )).limit(1);
  // Core modules predate the control-plane table. A missing record means the module
  // remains available; an explicit disabled/hidden/deleted state is authoritative.
  return !module || module.status === "active";
}

export async function resolveTelegramCapabilities(input: {
  userId: string;
  organizationId: string;
}) {
  const membership = await membershipContext(input.userId, input.organizationId);
  if (!membership) return [];
  const visible: TelegramCapability[] = [];
  for (const capability of TELEGRAM_CAPABILITIES) {
    const permissionAllowed = can(membership.role, capability.requiredPermission)
      || membership.custom.has(capability.requiredPermission);
    if (!permissionAllowed) continue;
    if (capability.adminOnly && !new Set<Role>(["owner", "admin", "developer", "operator"]).has(membership.role)) continue;
    if (!await moduleEnabled(input.organizationId, capability.requiredPlatformModule)) continue;
    if (!await telegramFeatureAllowed(input.userId, input.organizationId, capability.telegramFeatureKey)) continue;
    visible.push(capability);
  }
  return visible;
}

export async function assertTelegramCapability(input: {
  userId: string;
  organizationId: string;
  capabilityId: TelegramCapabilityId;
}) {
  const visible = await resolveTelegramCapabilities(input);
  return visible.find((capability) => capability.id === input.capabilityId) ?? null;
}
