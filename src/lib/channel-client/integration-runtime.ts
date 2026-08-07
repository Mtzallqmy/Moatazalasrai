import { ApiError } from "@/lib/http/api";
import { getOrganizationMcpServer, listOrganizationMcpCatalog } from "@/lib/mcp/application-service";
import {
  findOrganizationGitHubRepository,
  listOrganizationGitHubRepositories,
} from "@/lib/repositories/github-application-service";
import {
  getOrganizationSiteConnection,
  listOrganizationSiteConnections,
} from "@/lib/site-connections/application-service";
import { resolveChannelCapabilities } from "./capability-registry";
import { channelEmptyState, sendChannelClientView } from "./message-renderer";
import type { ChannelClientAction, ChannelClientRuntimeInput, ChannelClientRuntimeResult } from "./types";

function commandAction(input: ChannelClientRuntimeInput) {
  if (input.actionId) return input.actionId;
  const value = input.text.trim().toLocaleLowerCase("en-US").replace(/@\w+$/, "");
  if (["/start", "/menu", "/help", "القائمة", "الرئيسية", "مساعدة", "المساعدة"].includes(value)) return "cc.home";
  if (["/github", "/repos", "/repositories", "github", "جيت هب", "المستودعات", "مستودعات"].includes(value)) return "cc.repos";
  if (["/connections", "/sites", "الاتصالات", "اتصالات المواقع", "الحسابات المتصلة"].includes(value)) return "cc.connections";
  if (["/mcp", "mcp", "أدوات mcp", "خوادم mcp"].includes(value)) return "cc.mcp";
  return null;
}

async function capabilities(input: ChannelClientRuntimeInput) {
  return resolveChannelCapabilities({ identity: input.identity, featureAllowed: input.featureAllowed });
}

async function hasCapability(input: ChannelClientRuntimeInput, id: string) {
  return (await capabilities(input)).some((capability) => capability.id === id);
}

async function renderHome(input: ChannelClientRuntimeInput) {
  const visible = await capabilities(input);
  if (!visible.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد قدرات متاحة",
      reason: "لا توجد وحدة وصلاحية قناة مفعلة لهذا الحساب حاليًا.",
      path: ["الرئيسية"],
    }));
    return;
  }
  const groups = [
    { title: "العمل الذكي", ids: new Set(["chat.start", "agents.list", "agents.create", "teams.list", "runs.list"]) },
    { title: "المحتوى والمعرفة", ids: new Set(["files.receive"]) },
    { title: "القنوات والتكاملات", ids: new Set(["repositories.list", "site_connections.list", "mcp.list"]) },
    { title: "التشغيل", ids: new Set(["approvals.list", "browser.list", "sandbox.list"]) },
    { title: "الحساب", ids: new Set(["account.status"]) },
  ];
  const rows: ChannelClientAction[][] = [];
  const sectionLines: string[] = [];
  for (const group of groups) {
    const entries = visible
      .filter((capability) => group.ids.has(capability.id))
      .filter((capability, index, all) => all.findIndex((item) => item.actionId === capability.actionId) === index);
    if (!entries.length) continue;
    sectionLines.push(`${group.title}: ${entries.map((entry) => entry.labelAr).join("، ")}`);
    for (let index = 0; index < entries.length; index += 2) {
      rows.push(entries.slice(index, index + 2).map((entry) => ({
        id: entry.actionId,
        title: `${entry.icon ? `${entry.icon} ` : ""}${entry.labelAr}`.slice(0, 60),
      })));
    }
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية"],
    text: `${sectionLines.join("\n")}\n\nتظهر فقط القدرات التي اجتازت RBAC وصلاحية القناة والوحدة وحالة Runtime.`,
    actions: rows,
    editCurrent: Boolean(input.actionId),
  });
}

async function renderRepositories(input: ChannelClientRuntimeInput) {
  if (!await hasCapability(input, "repositories.list")) {
    throw new ApiError(403, "CHANNEL_REPOSITORIES_DENIED", "GitHub والمستودعات غير متاحة لحسابك أو غير مفعلة في سياسة القناة.");
  }
  try {
    const result = await listOrganizationGitHubRepositories({
      organizationId: input.identity.organizationId,
      userId: input.identity.userId,
      limit: 20,
    });
    if (!result.repositories.length) {
      await sendChannelClientView(input.transport, channelEmptyState({
        title: "GitHub متصل لكن لا توجد مستودعات متاحة",
        reason: "الاتصال متحقق، لكن GitHub لم يُرجع مستودعات يستطيع هذا التكامل قراءتها.",
        action: { id: "cc.home", title: "الرئيسية" },
        path: ["الرئيسية", "GitHub والمستودعات"],
      }));
      return;
    }
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "GitHub والمستودعات"],
      text: [
        `الاتصال: ${result.integration.name}`,
        `الحساب: ${result.integration.login ? `@${result.integration.login}` : "غير متاح"}`,
        `آخر تحقق: ${result.integration.lastVerifiedAt ? new Date(result.integration.lastVerifiedAt).toLocaleString("ar-SA") : "غير متاح"}`,
        ...result.repositories.map((repo, index) => [
          `${index + 1}. ${repo.fullName}`,
          `الخصوصية: ${repo.private ? "خاص" : "عام"}`,
          `الفرع الافتراضي: ${repo.defaultBranch}`,
          `اللغة: ${repo.language ?? "غير محددة"}`,
          `آخر تحديث في GitHub: ${new Date(repo.updatedAt).toLocaleString("ar-SA")}`,
        ].join("\n")),
      ].join("\n\n"),
      actions: [
        ...result.repositories.slice(0, 10).map((repo) => [{ id: `cc.repo:${repo.id}`, title: repo.name.slice(0, 55) }]),
        [{ id: "cc.repos", title: "تحديث" }, { id: "cc.home", title: "الرئيسية" }],
      ],
      editCurrent: Boolean(input.actionId),
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "GITHUB_NOT_CONFIGURED") {
      await sendChannelClientView(input.transport, channelEmptyState({
        title: "GitHub غير متصل",
        reason: "لا يوجد تكامل GitHub مفعّل ومتحقق لهذه المؤسسة. لا تُدخل أي Token داخل القناة؛ اربطه من لوحة الموقع.",
        action: { id: "open-integrations", url: "/dashboard/integrations", title: "فتح التكاملات" },
        path: ["الرئيسية", "GitHub والمستودعات"],
      }));
      return;
    }
    throw error;
  }
}

async function renderRepository(input: ChannelClientRuntimeInput, repositoryId: number) {
  if (!await hasCapability(input, "repositories.list")) throw new ApiError(403, "CHANNEL_REPOSITORIES_DENIED", "GitHub والمستودعات غير متاحة لحسابك.");
  const result = await findOrganizationGitHubRepository({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
    repositoryId,
  });
  const repo = result.repository;
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "GitHub والمستودعات", repo.name],
    text: [
      repo.fullName,
      repo.description || "بدون وصف",
      `الخصوصية: ${repo.private ? "خاص" : "عام"}`,
      `الفرع الافتراضي: ${repo.defaultBranch}`,
      `اللغة: ${repo.language ?? "غير محددة"}`,
      `الحجم: ${repo.sizeKb === null ? "غير متاح" : `${repo.sizeKb} KB`}`,
      `آخر تحديث: ${new Date(repo.updatedAt).toLocaleString("ar-SA")}`,
      `صلاحيات GitHub: قراءة ${repo.permissions?.pull === false ? "غير متاحة" : "متاحة"}، كتابة ${repo.permissions?.push ? "متاحة" : "غير متاحة"}`,
    ].join("\n"),
    actions: [[
      { id: "cc.repos", title: "رجوع" },
      { id: "open-repositories", url: "/dashboard/repositories", title: "فتح في الموقع" },
    ]],
    editCurrent: Boolean(input.actionId),
  });
}

async function renderConnections(input: ChannelClientRuntimeInput) {
  if (!await hasCapability(input, "site_connections.list")) throw new ApiError(403, "CHANNEL_CONNECTIONS_DENIED", "اتصالات المواقع غير متاحة لحسابك.");
  const connections = await listOrganizationSiteConnections({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
  });
  if (!connections.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد اتصالات مواقع",
      reason: "لا يوجد اتصال موقع موثق. أنشئ الاتصال عبر OAuth أو جلسة المتصفح أو API من لوحة الموقع، ولا ترسل بيانات اعتماد داخل القناة.",
      action: { id: "open-site-connections", url: "/dashboard/site-connections", title: "فتح الاتصالات" },
      path: ["الرئيسية", "اتصالات المواقع"],
    }));
    return;
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "اتصالات المواقع"],
    text: connections.map((connection, index) => [
      `${index + 1}. ${connection.name}`,
      `الموقع: ${connection.siteDomain}`,
      `الموصل: ${connection.connectorKey} (${connection.connectorType})`,
      `الحالة: ${connection.status}`,
      `النطاقات المسموحة: ${connection.allowedDomains.join("، ") || "لا يوجد"}`,
      `الوكلاء المرتبطون: ${connection.agents.filter((agent) => agent.enabled).map((agent) => agent.agentName).join("، ") || "لا يوجد"}`,
      `آخر تحقق: ${connection.lastVerifiedAt ? connection.lastVerifiedAt.toLocaleString("ar-SA") : "لم يتحقق"}`,
      `آخر استخدام: ${connection.lastUsedAt ? connection.lastUsedAt.toLocaleString("ar-SA") : "لم يستخدم"}`,
    ].join("\n")).join("\n\n"),
    actions: [
      ...connections.slice(0, 10).map((connection) => [{ id: `cc.connection:${connection.id}`, title: connection.name.slice(0, 55) }]),
      [{ id: "cc.connections", title: "تحديث" }, { id: "cc.home", title: "الرئيسية" }],
    ],
    editCurrent: Boolean(input.actionId),
  });
}

async function renderConnection(input: ChannelClientRuntimeInput, connectionId: string) {
  if (!await hasCapability(input, "site_connections.list")) throw new ApiError(403, "CHANNEL_CONNECTIONS_DENIED", "اتصالات المواقع غير متاحة لحسابك.");
  const connection = await getOrganizationSiteConnection({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
    connectionId,
  });
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "اتصالات المواقع", connection.name],
    text: [
      connection.name,
      `الموقع: ${connection.siteDomain}`,
      `الموصل: ${connection.connectorKey}`,
      `النوع: ${connection.connectorType}`,
      `الحالة: ${connection.status}`,
      `النطاقات: ${connection.allowedDomains.join("، ") || "لا يوجد"}`,
      `الصلاحيات الممنوحة: ${connection.grantedScopes.join("، ") || "غير متاحة"}`,
      `انتهاء الاعتماد: ${connection.expiresAt ? connection.expiresAt.toLocaleString("ar-SA") : "غير محدد"}`,
      `الوكلاء: ${connection.agents.map((agent) => `${agent.agentName} — ${agent.enabled ? "مفعّل" : "معطّل"}`).join("، ") || "لا يوجد"}`,
    ].join("\n"),
    actions: [[{ id: "cc.connections", title: "رجوع" }, { id: "open-site-connections", url: "/dashboard/site-connections", title: "فتح في الموقع" }]],
    editCurrent: Boolean(input.actionId),
  });
}

async function renderMcp(input: ChannelClientRuntimeInput) {
  if (!await hasCapability(input, "mcp.list")) throw new ApiError(403, "CHANNEL_MCP_DENIED", "MCP غير متاح لحسابك.");
  const servers = await listOrganizationMcpCatalog({ organizationId: input.identity.organizationId, userId: input.identity.userId });
  if (!servers.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد خوادم MCP",
      reason: "لم تُضف المؤسسة خادم MCP بعد. أضفه من لوحة MCP ثم نفذ مزامنة حقيقية للكتالوج.",
      action: { id: "open-mcp", url: "/dashboard/mcp", title: "فتح MCP" },
      path: ["الرئيسية", "MCP"],
    }));
    return;
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "MCP"],
    text: servers.map((server, index) => [
      `${index + 1}. ${server.name}`,
      `الحالة: ${server.enabled ? "مفعّل" : "معطّل"}`,
      `المصادقة: ${server.authType}`,
      `آخر اتصال: ${server.lastConnectedAt ? server.lastConnectedAt.toLocaleString("ar-SA") : "لم يتصل"}`,
      `خطأ حالي: ${server.lastError ? "نعم" : "لا"}`,
      `الأدوات: ${server.tools.filter((tool) => tool.enabled).length}`,
      `الموارد: ${server.resources.filter((resource) => resource.enabled).length}`,
      `القوالب: ${server.resourceTemplates.filter((template) => template.enabled).length}`,
      `الموجهات: ${server.prompts.filter((prompt) => prompt.enabled).length}`,
    ].join("\n")).join("\n\n"),
    actions: [
      ...servers.slice(0, 10).map((server) => [{ id: `cc.mcp:${server.id}`, title: server.name.slice(0, 55) }]),
      [{ id: "cc.mcp", title: "تحديث" }, { id: "cc.home", title: "الرئيسية" }],
    ],
    editCurrent: Boolean(input.actionId),
  });
}

async function renderMcpServer(input: ChannelClientRuntimeInput, serverId: string) {
  if (!await hasCapability(input, "mcp.list")) throw new ApiError(403, "CHANNEL_MCP_DENIED", "MCP غير متاح لحسابك.");
  const server = await getOrganizationMcpServer({ organizationId: input.identity.organizationId, userId: input.identity.userId, serverId });
  const tools = server.tools.filter((tool) => tool.enabled).slice(0, 12);
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "MCP", server.name],
    text: [
      server.name,
      `الحالة: ${server.enabled ? "مفعّل" : "معطّل"}`,
      `المصادقة: ${server.authType}`,
      `آخر اتصال: ${server.lastConnectedAt ? server.lastConnectedAt.toLocaleString("ar-SA") : "لم يتصل"}`,
      `خطأ حالي: ${server.lastError ? "نعم — راجع لوحة MCP للتفاصيل الآمنة" : "لا"}`,
      `الأدوات المفعلة (${server.tools.filter((tool) => tool.enabled).length}):`,
      ...(tools.length ? tools.map((tool) => `• ${tool.name} — مخاطر ${tool.risk} — موافقة ${tool.approvalMode}`) : ["• لا توجد أدوات مفعلة"]),
      `الموارد: ${server.resources.filter((resource) => resource.enabled).length}`,
      `الموجهات: ${server.prompts.filter((prompt) => prompt.enabled).length}`,
    ].join("\n"),
    actions: [[{ id: "cc.mcp", title: "رجوع" }, { id: "open-mcp", url: "/dashboard/mcp", title: "فتح في الموقع" }]],
    editCurrent: Boolean(input.actionId),
  });
}

export async function processChannelIntegrations(input: ChannelClientRuntimeInput): Promise<ChannelClientRuntimeResult | null> {
  const action = commandAction(input);
  if (action === "cc.home") {
    await renderHome(input);
    return { handled: true, session: input.session };
  }
  if (action === "cc.repos") {
    await renderRepositories(input);
    return { handled: true, session: input.session };
  }
  const repository = /^cc\.repo:(\d+)$/.exec(action ?? "");
  if (repository) {
    await renderRepository(input, Number(repository[1]));
    return { handled: true, session: input.session };
  }
  if (action === "cc.connections") {
    await renderConnections(input);
    return { handled: true, session: input.session };
  }
  const connection = /^cc\.connection:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (connection) {
    await renderConnection(input, connection[1]);
    return { handled: true, session: input.session };
  }
  if (action === "cc.mcp") {
    await renderMcp(input);
    return { handled: true, session: input.session };
  }
  const mcp = /^cc\.mcp:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (mcp) {
    await renderMcpServer(input, mcp[1]);
    return { handled: true, session: input.session };
  }
  return null;
}
