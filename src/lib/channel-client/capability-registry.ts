import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformModules } from "@/db/control-plane-schema";
import { userHasPermission } from "@/lib/auth/user-authorization";
import type { Permission } from "@/lib/auth/permissions";
import { env } from "@/lib/config/env";
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
  requiredRuntime?: "browser" | "sandbox";
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
    requiredPlatformModule: "agents",
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
    requiredPlatformModule: "agents",
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
    requiredPlatformModule: "agents",
    fallbackDashboardUrl: "/dashboard/agents",
    supportsPagination: false,
    destructive: false,
    adminOnly: true,
    actionId: "cc.agent.create",
  },
  {
    id: "teams.list",
    labelAr: "فرق الوكلاء",
    descriptionAr: "عرض الفرق الحقيقية وأعضائها وجاهزيتها.",
    icon: "👥",
    requiredPermission: "agents:read",
    telegramFeatureKey: "telegram.agents",
    whatsappFeatureKey: "whatsapp.agents",
    requiredPlatformModule: "agents",
    fallbackDashboardUrl: "/dashboard/teams",
    supportsPagination: true,
    destructive: false,
    adminOnly: false,
    actionId: "cc.teams:1",
  },
  {
    id: "teams.run",
    labelAr: "تشغيل فريق",
    descriptionAr: "إنشاء تشغيل حقيقي لفريق عبر Graphile Worker بعد تأكيد المستخدم.",
    icon: "▶️",
    requiredPermission: "agents:run",
    telegramFeatureKey: "telegram.agents",
    whatsappFeatureKey: "whatsapp.agents",
    requiredPlatformModule: "agents",
    fallbackDashboardUrl: "/dashboard/teams",
    supportsPagination: false,
    destructive: true,
    adminOnly: false,
    actionId: "cc.teams:1",
  },
  {
    id: "runs.list",
    labelAr: "عمليات التشغيل",
    descriptionAr: "عرض حالات تشغيل فرق الوكلاء والتفاصيل الفعلية.",
    icon: "📈",
    requiredPermission: "runs:read",
    telegramFeatureKey: "telegram.agents",
    whatsappFeatureKey: "whatsapp.agents",
    requiredPlatformModule: "agents",
    fallbackDashboardUrl: "/dashboard/runs",
    supportsPagination: true,
    destructive: false,
    adminOnly: false,
    actionId: "cc.runs:1",
  },
  {
    id: "approvals.list",
    labelAr: "الموافقات",
    descriptionAr: "عرض طلبات الأدوات الحقيقية واتخاذ قرار مؤكد ثم استئناف التنفيذ.",
    icon: "✅",
    requiredPermission: "runs:read",
    telegramFeatureKey: "telegram.admin_commands",
    whatsappFeatureKey: "whatsapp.admin_commands",
    requiredPlatformModule: "security_center",
    fallbackDashboardUrl: "/dashboard/approvals",
    supportsPagination: false,
    destructive: true,
    adminOnly: true,
    actionId: "cc.approvals",
  },
  {
    id: "files.receive",
    labelAr: "الملفات والوسائط",
    descriptionAr: "إرسال ملف أو صورة أو صوت أو فيديو إلى المحادثة النشطة.",
    icon: "📎",
    requiredPermission: "files:upload",
    telegramFeatureKey: "telegram.files",
    whatsappFeatureKey: "whatsapp.files",
    requiredPlatformModule: "content",
    fallbackDashboardUrl: "/dashboard/files",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
    actionId: "cc.files",
  },
  {
    id: "repositories.list",
    labelAr: "GitHub والمستودعات",
    descriptionAr: "عرض اتصال GitHub المتحقق والمستودعات الحقيقية دون كشف التوكن.",
    icon: "🐙",
    requiredPermission: "integrations:read",
    telegramFeatureKey: "telegram.admin_commands",
    whatsappFeatureKey: "whatsapp.admin_commands",
    requiredPlatformModule: "content",
    fallbackDashboardUrl: "/dashboard/repositories",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
    actionId: "cc.repos",
  },
  {
    id: "browser.list",
    labelAr: "مهام المتصفح",
    descriptionAr: "عرض مهام Browser Runtime الحقيقية وحالاتها وأخطائها.",
    icon: "🌐",
    requiredPermission: "browser_tasks:read",
    telegramFeatureKey: "telegram.admin_commands",
    whatsappFeatureKey: "whatsapp.admin_commands",
    requiredRuntime: "browser",
    fallbackDashboardUrl: "/dashboard/browser-tasks",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
    actionId: "cc.browser",
  },
  {
    id: "sandbox.list",
    labelAr: "Sandbox",
    descriptionAr: "عرض مساحات Sandbox والتنفيذات والسياسات والأخطاء الحقيقية.",
    icon: "🧪",
    requiredPermission: "sandbox:read",
    telegramFeatureKey: "telegram.admin_commands",
    whatsappFeatureKey: "whatsapp.admin_commands",
    requiredRuntime: "sandbox",
    fallbackDashboardUrl: "/dashboard/sandbox",
    supportsPagination: false,
    destructive: false,
    adminOnly: false,
    actionId: "cc.sandbox",
  },
  {
    id: "account.status",
    labelAr: "الحساب والجلسة",
    descriptionAr: "عرض المؤسسة والدور والوكيل والمحادثة النشطين.",
    icon: "👤",
    requiredPlatformModule: "channels",
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

function runtimeEnabled(runtime: ChannelCapability["requiredRuntime"]) {
  if (!runtime) return true;
  const configuration = env();
  return runtime === "browser" ? configuration.browserAgentEnabled : configuration.sandboxEnabled;
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
    if (!runtimeEnabled(capability.requiredRuntime)) continue;
    visible.push(capability);
  }
  return visible;
}
