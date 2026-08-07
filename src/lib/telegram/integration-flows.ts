import { ApiError } from "@/lib/http/api";
import { telegramPlatformConfig } from "@/lib/integrations/telegram-platform";
import type { TelegramInlineButton } from "@/lib/integrations/telegram";
import { getOrganizationMcpServer, listOrganizationMcpCatalog } from "@/lib/mcp/application-service";
import {
  getOrganizationSiteConnection,
  listOrganizationSiteConnections,
} from "@/lib/site-connections/application-service";
import { assertTelegramCapability } from "./capability-registry";
import { sendTelegramEmptyState, sendTelegramList, sendTelegramMenu } from "./message-renderer";

type IntegrationContext = {
  token: string;
  chatId: string;
  userId: string;
  organizationId: string;
};

function dashboardButton(path: string, title: string): TelegramInlineButton[] {
  const base = telegramPlatformConfig().publicAppUrl?.trim().replace(/\/$/, "");
  return base ? [{ url: `${base}${path}`, title }] : [];
}

async function assertCapability(input: IntegrationContext, capabilityId: "site_connections.list" | "mcp.list") {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId,
  });
  if (!capability) {
    throw new ApiError(403, capabilityId === "mcp.list" ? "TELEGRAM_MCP_DENIED" : "TELEGRAM_SITE_CONNECTIONS_DENIED", "التكامل المطلوب غير متاح لحسابك.");
  }
}

export async function listTelegramSiteConnections(input: IntegrationContext) {
  await assertCapability(input, "site_connections.list");
  const connections = await listOrganizationSiteConnections({ organizationId: input.organizationId, userId: input.userId });
  if (!connections.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا يوجد اتصال موقع موثق في المؤسسة.",
      action: "أنشئ الاتصال من لوحة الموقع عبر OAuth أو جلسة المتصفح أو API. لا ترسل بيانات اعتماد داخل Telegram.",
      buttonRows: [
        ...dashboardButton("/dashboard/site-connections", "فتح اتصالات المواقع").map((button) => [button]),
        [{ id: "nav:home", title: "الرئيسية" }],
      ],
    });
    return;
  }
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: "الرئيسية ← القنوات والتكاملات ← اتصالات المواقع",
    items: connections.map((connection, index) => [
      `${index + 1}. ${connection.name}`,
      `الموقع: ${connection.siteDomain}`,
      `الموصل: ${connection.connectorKey} (${connection.connectorType})`,
      `الحالة: ${connection.status}`,
      `الوكلاء المرتبطون: ${connection.agents.filter((agent) => agent.enabled).map((agent) => agent.agentName).join("، ") || "لا يوجد"}`,
      `آخر تحقق: ${connection.lastVerifiedAt ? connection.lastVerifiedAt.toLocaleString("ar-SA") : "لم يتحقق"}`,
      `آخر استخدام: ${connection.lastUsedAt ? connection.lastUsedAt.toLocaleString("ar-SA") : "لم يستخدم"}`,
    ].join("\n")),
    emptyText: "لا توجد اتصالات مواقع.",
    buttonRows: [
      ...connections.slice(0, 10).map((connection) => [{ id: `connection:view:${connection.id}`, title: connection.name.slice(0, 55) }]),
      [{ id: "connections:list", title: "تحديث" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function showTelegramSiteConnection(input: IntegrationContext & { connectionId: string }) {
  await assertCapability(input, "site_connections.list");
  const connection = await getOrganizationSiteConnection({
    organizationId: input.organizationId,
    userId: input.userId,
    connectionId: input.connectionId,
  });
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: [
      `الرئيسية ← اتصالات المواقع ← ${connection.name}`,
      `الموقع: ${connection.siteDomain}`,
      `الموصل: ${connection.connectorKey}`,
      `النوع: ${connection.connectorType}`,
      `الحالة: ${connection.status}`,
      `النطاقات المسموحة: ${connection.allowedDomains.join("، ") || "لا يوجد"}`,
      `الصلاحيات الممنوحة: ${connection.grantedScopes.join("، ") || "غير متاحة"}`,
      `انتهاء الاعتماد: ${connection.expiresAt ? connection.expiresAt.toLocaleString("ar-SA") : "غير محدد"}`,
      `الوكلاء: ${connection.agents.map((agent) => `${agent.agentName} — ${agent.enabled ? "مفعّل" : "معطّل"}`).join("، ") || "لا يوجد"}`,
    ].join("\n"),
    buttonRows: [[
      { id: "connections:list", title: "رجوع" },
      ...dashboardButton("/dashboard/site-connections", "فتح في الموقع"),
    ]],
  });
}

export async function listTelegramMcp(input: IntegrationContext) {
  await assertCapability(input, "mcp.list");
  const servers = await listOrganizationMcpCatalog({ organizationId: input.organizationId, userId: input.userId });
  if (!servers.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا توجد خوادم MCP مسجلة في المؤسسة.",
      action: "أضف خادم MCP ونفّذ مزامنة الكتالوج من لوحة الموقع.",
      buttonRows: [
        ...dashboardButton("/dashboard/mcp", "فتح MCP").map((button) => [button]),
        [{ id: "nav:home", title: "الرئيسية" }],
      ],
    });
    return;
  }
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: "الرئيسية ← القنوات والتكاملات ← MCP",
    items: servers.map((server, index) => [
      `${index + 1}. ${server.name}`,
      `الحالة: ${server.enabled ? "مفعّل" : "معطّل"}`,
      `المصادقة: ${server.authType}`,
      `آخر اتصال: ${server.lastConnectedAt ? server.lastConnectedAt.toLocaleString("ar-SA") : "لم يتصل"}`,
      `خطأ حالي: ${server.lastError ? "نعم" : "لا"}`,
      `الأدوات: ${server.tools.filter((tool) => tool.enabled).length}`,
      `الموارد: ${server.resources.filter((resource) => resource.enabled).length}`,
      `الموجهات: ${server.prompts.filter((prompt) => prompt.enabled).length}`,
    ].join("\n")),
    emptyText: "لا توجد خوادم MCP.",
    buttonRows: [
      ...servers.slice(0, 10).map((server) => [{ id: `mcp:view:${server.id}`, title: server.name.slice(0, 55) }]),
      [{ id: "mcp:list", title: "تحديث" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function showTelegramMcpServer(input: IntegrationContext & { serverId: string }) {
  await assertCapability(input, "mcp.list");
  const server = await getOrganizationMcpServer({ organizationId: input.organizationId, userId: input.userId, serverId: input.serverId });
  const tools = server.tools.filter((tool) => tool.enabled).slice(0, 12);
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: [
      `الرئيسية ← MCP ← ${server.name}`,
      `الحالة: ${server.enabled ? "مفعّل" : "معطّل"}`,
      `المصادقة: ${server.authType}`,
      `آخر اتصال: ${server.lastConnectedAt ? server.lastConnectedAt.toLocaleString("ar-SA") : "لم يتصل"}`,
      `خطأ حالي: ${server.lastError ? "نعم — راجع لوحة MCP للتفاصيل" : "لا"}`,
      `الأدوات المفعلة (${server.tools.filter((tool) => tool.enabled).length}):`,
      ...(tools.length ? tools.map((tool) => `• ${tool.name} — مخاطر ${tool.risk} — موافقة ${tool.approvalMode}`) : ["• لا توجد أدوات مفعلة"]),
      `الموارد: ${server.resources.filter((resource) => resource.enabled).length}`,
      `الموجهات: ${server.prompts.filter((prompt) => prompt.enabled).length}`,
    ].join("\n"),
    buttonRows: [[
      { id: "mcp:list", title: "رجوع" },
      ...dashboardButton("/dashboard/mcp", "فتح في الموقع"),
    ]],
  });
}
