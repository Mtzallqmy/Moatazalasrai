import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformModules } from "@/db/control-plane-schema";
import { telegramFeaturePermissions } from "@/db/telegram-platform-schema";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can, type Permission } from "@/lib/auth/permissions";
import type { TelegramFeatureKey } from "@/lib/integrations/telegram-platform";
import { renderAccount } from "@/lib/telegram/account-flows";
import { renderAgents, startAgentCreation } from "@/lib/telegram/agent-flows";
import { renderApprovals } from "@/lib/telegram/approval-flows";
import { openConversation } from "@/lib/telegram/conversation-flows";
import { renderFiles } from "@/lib/telegram/file-flows";
import {
  renderAudit,
  renderBrowserTasks,
  renderChannels,
  renderContent,
  renderKnowledgeBases,
  renderMcp,
  renderMembers,
  renderNotifications,
  renderPlatformHealth,
  renderProviders,
  renderRepositories,
  renderSandbox,
} from "@/lib/telegram/platform-flows";
import { renderRuns, renderTeams } from "@/lib/telegram/team-flows";
import type { TelegramActionContext } from "@/lib/telegram/types";

export type TelegramCapabilitySection =
  | "smart_work"
  | "content_knowledge"
  | "channels_integrations"
  | "operations"
  | "administration";

export type TelegramCapability = {
  id: string;
  section: TelegramCapabilitySection;
  labelAr: string;
  descriptionAr: string;
  icon?: string;
  requiredPermission?: Permission;
  telegramFeatureKey: TelegramFeatureKey;
  requiredPlatformModule: string;
  visibilityResolver?: (context: TelegramActionContext) => boolean | Promise<boolean>;
  handler: (context: TelegramActionContext) => Promise<unknown>;
  emptyStateHandler?: (context: TelegramActionContext) => Promise<unknown>;
  fallbackDashboardUrl: string;
  supportsPagination: boolean;
  destructive: boolean;
  adminOnly: boolean;
};

export const TELEGRAM_CAPABILITIES: readonly TelegramCapability[] = [
  {
    id: "chat.open", section: "smart_work", labelAr: "محادثة", descriptionAr: "محادثة حقيقية مع وكيل منشور.", icon: "💬",
    requiredPermission: "agents:run", telegramFeatureKey: "telegram.chat", requiredPlatformModule: "agents",
    handler: openConversation, fallbackDashboardUrl: "/dashboard/chat", supportsPagination: false, destructive: false, adminOnly: false,
  },
  {
    id: "agents.list", section: "smart_work", labelAr: "الوكلاء", descriptionAr: "الوكلاء الفعليون وحالة جاهزيتهم.", icon: "🤖",
    requiredPermission: "agents:read", telegramFeatureKey: "telegram.agents", requiredPlatformModule: "agents",
    handler: renderAgents, fallbackDashboardUrl: "/dashboard/agents", supportsPagination: true, destructive: false, adminOnly: false,
  },
  {
    id: "agents.create", section: "smart_work", labelAr: "إنشاء وكيل", descriptionAr: "تدفق كامل لإنشاء وكيل بالمزود والنموذج.", icon: "➕",
    requiredPermission: "agents:manage", telegramFeatureKey: "telegram.agents", requiredPlatformModule: "agents",
    handler: startAgentCreation, fallbackDashboardUrl: "/dashboard/agents", supportsPagination: false, destructive: false, adminOnly: false,
  },
  {
    id: "teams.list", section: "smart_work", labelAr: "فرق الوكلاء", descriptionAr: "الفرق الحقيقية وتشغيلها.", icon: "👥",
    requiredPermission: "agents:read", telegramFeatureKey: "telegram.agents", requiredPlatformModule: "agents",
    handler: renderTeams, fallbackDashboardUrl: "/dashboard/teams", supportsPagination: true, destructive: false, adminOnly: false,
  },
  {
    id: "runs.list", section: "smart_work", labelAr: "عمليات التشغيل", descriptionAr: "عمليات فرق الوكلاء وحالاتها.", icon: "▶️",
    requiredPermission: "runs:read", telegramFeatureKey: "telegram.agents", requiredPlatformModule: "agents",
    handler: renderRuns, fallbackDashboardUrl: "/dashboard/runs", supportsPagination: true, destructive: false, adminOnly: false,
  },
  {
    id: "files.list", section: "content_knowledge", labelAr: "الملفات", descriptionAr: "الملفات المخزنة فعليًا.", icon: "📎",
    requiredPermission: "files:read", telegramFeatureKey: "telegram.files", requiredPlatformModule: "content",
    handler: renderFiles, fallbackDashboardUrl: "/dashboard/files", supportsPagination: true, destructive: false, adminOnly: false,
  },
  {
    id: "knowledge.list", section: "content_knowledge", labelAr: "قواعد المعرفة", descriptionAr: "قواعد المعرفة الفعلية.", icon: "📚",
    requiredPermission: "files:read", telegramFeatureKey: "telegram.files", requiredPlatformModule: "content",
    handler: renderKnowledgeBases, fallbackDashboardUrl: "/dashboard/knowledge", supportsPagination: false, destructive: false, adminOnly: false,
  },
  {
    id: "content.list", section: "content_knowledge", labelAr: "المحتوى", descriptionAr: "صفحات المحتوى الفعلية.", icon: "📝",
    requiredPermission: "content:read", telegramFeatureKey: "telegram.files", requiredPlatformModule: "content",
    handler: renderContent, fallbackDashboardUrl: "/dashboard/content", supportsPagination: false, destructive: false, adminOnly: false,
  },
  {
    id: "channels.list", section: "channels_integrations", labelAr: "القنوات", descriptionAr: "اتصالات القنوات وصحتها.", icon: "📡",
    requiredPermission: "channels:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "channels",
    handler: renderChannels, fallbackDashboardUrl: "/dashboard/channels", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "repositories.list", section: "channels_integrations", labelAr: "GitHub والمستودعات", descriptionAr: "مستودعات الاتصال المتحقق.", icon: "🗃️",
    requiredPermission: "integrations:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "channels",
    handler: renderRepositories, fallbackDashboardUrl: "/dashboard/repositories", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "providers.list", section: "channels_integrations", labelAr: "المزودون والنماذج", descriptionAr: "حالة المزودين والنماذج المكتشفة.", icon: "🧠",
    requiredPermission: "providers:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "providers",
    handler: renderProviders, fallbackDashboardUrl: "/dashboard/providers", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "approvals.list", section: "operations", labelAr: "الموافقات", descriptionAr: "موافقات الأدوات المعلقة.", icon: "✅",
    requiredPermission: "agents:run", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "agents",
    visibilityResolver: (context) => ["owner", "admin", "developer", "operator"].includes(context.actor.role),
    handler: renderApprovals, fallbackDashboardUrl: "/dashboard/approvals", supportsPagination: false, destructive: false, adminOnly: false,
  },
  {
    id: "mcp.list", section: "operations", labelAr: "MCP", descriptionAr: "خوادم MCP والأدوات المفعلة.", icon: "🔌",
    requiredPermission: "agents:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "agents",
    handler: renderMcp, fallbackDashboardUrl: "/dashboard/mcp", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "browser.list", section: "operations", labelAr: "مهام المتصفح", descriptionAr: "مهام المتصفح الفعلية.", icon: "🌐",
    requiredPermission: "browser_tasks:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "agents",
    handler: renderBrowserTasks, fallbackDashboardUrl: "/dashboard/browser", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "sandbox.list", section: "operations", labelAr: "بيئة التنفيذ", descriptionAr: "مساحات Sandbox وعمليات التنفيذ.", icon: "🧪",
    requiredPermission: "sandbox:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "agents",
    handler: renderSandbox, fallbackDashboardUrl: "/dashboard/sandbox", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "notifications.list", section: "administration", labelAr: "الإشعارات", descriptionAr: "إشعارات الحساب الحقيقية.", icon: "🔔",
    requiredPermission: "notifications:read", telegramFeatureKey: "telegram.notifications", requiredPlatformModule: "notifications",
    handler: renderNotifications, fallbackDashboardUrl: "/dashboard/notifications", supportsPagination: false, destructive: false, adminOnly: false,
  },
  {
    id: "members.list", section: "administration", labelAr: "الأعضاء والصلاحيات", descriptionAr: "أعضاء المؤسسة وأدوارهم.", icon: "👤",
    requiredPermission: "members:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "users",
    handler: renderMembers, fallbackDashboardUrl: "/dashboard/members", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "audit.list", section: "administration", labelAr: "سجل التدقيق", descriptionAr: "أحداث التدقيق الفعلية.", icon: "🧾",
    requiredPermission: "audit:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "audit",
    handler: renderAudit, fallbackDashboardUrl: "/dashboard/audit", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "health.view", section: "administration", labelAr: "صحة المنصة", descriptionAr: "قاعدة البيانات والعامل الخلفي.", icon: "🩺",
    requiredPermission: "platform:read", telegramFeatureKey: "telegram.admin_commands", requiredPlatformModule: "audit",
    handler: renderPlatformHealth, fallbackDashboardUrl: "/dashboard/operations", supportsPagination: false, destructive: false, adminOnly: true,
  },
  {
    id: "account.view", section: "administration", labelAr: "الحساب", descriptionAr: "الحساب والمؤسسة والجلسة النشطة.", icon: "⚙️",
    telegramFeatureKey: "telegram.chat", requiredPlatformModule: "settings",
    handler: renderAccount, fallbackDashboardUrl: "/dashboard/integrations", supportsPagination: false, destructive: false, adminOnly: false,
  },
] as const;

export async function visibleTelegramCapabilities(context: TelegramActionContext) {
  const [moduleRows, featureRows, customPermissions] = await Promise.all([
    db().select({ key: platformModules.key }).from(platformModules).where(and(
      eq(platformModules.organizationId, context.actor.organizationId),
      eq(platformModules.status, "active"),
    )),
    db().select({ featureKey: telegramFeaturePermissions.featureKey }).from(telegramFeaturePermissions).where(and(
      eq(telegramFeaturePermissions.userId, context.actor.userId),
      eq(telegramFeaturePermissions.organizationId, context.actor.organizationId),
      eq(telegramFeaturePermissions.enabled, true),
    )),
    loadCustomPermissions(context.actor.organizationId, context.actor.userId),
  ]);
  const modules = new Set(moduleRows.map((row) => row.key));
  const features = new Set(featureRows.map((row) => row.featureKey));
  const custom = new Set(customPermissions);
  const result: TelegramCapability[] = [];
  for (const capability of TELEGRAM_CAPABILITIES) {
    if (!modules.has(capability.requiredPlatformModule)) continue;
    if (!features.has(capability.telegramFeatureKey)) continue;
    if (capability.adminOnly && !["owner", "admin"].includes(context.actor.role)) continue;
    if (capability.requiredPermission
      && !can(context.actor.role, capability.requiredPermission)
      && !custom.has(capability.requiredPermission)) continue;
    if (capability.visibilityResolver && !await capability.visibilityResolver(context)) continue;
    result.push(capability);
  }
  return result;
}

export function telegramCapability(id: string) {
  return TELEGRAM_CAPABILITIES.find((capability) => capability.id === id) ?? null;
}
