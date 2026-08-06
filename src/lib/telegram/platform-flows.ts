import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { db, checkDatabase } from "@/db";
import { channelConnections } from "@/db/channel-schema";
import { internalNotifications, sitePages } from "@/db/control-plane-schema";
import { browserTasks, siteConnections } from "@/db/site-connections-schema";
import { sandboxExecutions, sandboxWorkspaces } from "@/db/sandbox-schema";
import {
  auditLogs,
  integrations,
  knowledgeBases,
  mcpServers,
  mcpTools,
  organizationMembers,
  providerCredentials,
  users,
} from "@/db/schema";
import { assertActorPermission } from "@/lib/auth/actor-authorization";
import { ApiError } from "@/lib/http/api";
import { listGitHubRepositories } from "@/lib/integrations/github";
import { decryptSecret } from "@/lib/security/encryption";
import { sendTelegramEmptyState, sendTelegramList, sendTelegramMenu } from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";

function messageId(context: TelegramActionContext) {
  return context.update.kind === "callback_query" ? context.update.messageId : undefined;
}

function pager(id: string, page: number, pages: number) {
  const row = [] as Array<{ id: string; title: string }>;
  if (page > 1) row.push({ id: `cap:${id}:${page - 1}`, title: "السابق" });
  if (page < pages) row.push({ id: `cap:${id}:${page + 1}`, title: "التالي" });
  return row;
}

export async function renderProviders(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "providers:read");
  const rows = await db().select({
    name: providerCredentials.name,
    provider: providerCredentials.provider,
    status: providerCredentials.validationStatus,
    health: providerCredentials.healthStatus,
    enabled: providerCredentials.enabled,
    defaultModel: providerCredentials.defaultModel,
    models: providerCredentials.discoveredModels,
    lastCheckedAt: providerCredentials.lastCheckedAt,
  }).from(providerCredentials).where(eq(providerCredentials.organizationId, context.actor.organizationId))
    .orderBy(desc(providerCredentials.isDefault), asc(providerCredentials.name));
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← المزودون والنماذج",
    title: "المزودون الفعليون",
    items: rows.map((row, index) => `${index + 1}. ${row.name}\nالنوع: ${row.provider}\nالحالة: ${row.status} — الصحة: ${row.health}\nمفعّل: ${row.enabled ? "نعم" : "لا"}\nالنموذج الافتراضي: ${row.defaultModel ?? "غير محدد"}\nالنماذج المكتشفة: ${row.models.length}\nآخر فحص: ${row.lastCheckedAt?.toISOString() ?? "لم يُفحص"}`),
    emptyText: "لا يوجد مزود مسجل. لا يمكن إنشاء أو تشغيل وكيل كامل قبل إضافة مزود متحقق.",
    buttonRows: [[{ title: "إدارة المزودين في الموقع", url: `${context.dashboardUrl}/dashboard/providers` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:providers.list:1", title: "تحديث" }]],
  });
}

export async function renderChannels(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "channels:read");
  const rows = await db().select({
    kind: channelConnections.kind,
    name: channelConnections.name,
    displayAddress: channelConnections.displayAddress,
    status: channelConnections.status,
    enabled: channelConnections.enabled,
    webhookStatus: channelConnections.webhookStatus,
    lastHealthAt: channelConnections.lastHealthAt,
    lastErrorCode: channelConnections.lastErrorCode,
  }).from(channelConnections).where(eq(channelConnections.organizationId, context.actor.organizationId))
    .orderBy(asc(channelConnections.kind), asc(channelConnections.name));
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← القنوات والتكاملات ← القنوات",
    title: "اتصالات القنوات الحقيقية",
    items: rows.map((row, index) => `${index + 1}. ${row.name}\nالقناة: ${row.kind}\nالعنوان: ${row.displayAddress ?? "غير متاح"}\nالحالة: ${row.status}\nWebhook: ${row.webhookStatus}\nمفعّل: ${row.enabled ? "نعم" : "لا"}\nآخر فحص: ${row.lastHealthAt?.toISOString() ?? "لم يُفحص"}${row.lastErrorCode ? `\nرمز الخطأ: ${row.lastErrorCode}` : ""}`),
    emptyText: "لا توجد اتصالات قنوات في المؤسسة.",
    buttonRows: [[{ title: "فتح إدارة القنوات", url: `${context.dashboardUrl}/dashboard/channels` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:channels.list:1", title: "تحديث" }]],
  });
}

export async function renderKnowledgeBases(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "files:read");
  const rows = await db().select({
    name: knowledgeBases.name,
    description: knowledgeBases.description,
    updatedAt: knowledgeBases.updatedAt,
  }).from(knowledgeBases).where(eq(knowledgeBases.organizationId, context.actor.organizationId))
    .orderBy(desc(knowledgeBases.updatedAt));
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← المحتوى والمعرفة ← قواعد المعرفة",
    title: "قواعد المعرفة الفعلية",
    items: rows.map((row, index) => `${index + 1}. ${row.name}\n${row.description || "بدون وصف"}\nآخر تحديث: ${row.updatedAt.toISOString()}`),
    emptyText: "لا توجد قواعد معرفة في المؤسسة.",
    buttonRows: [[{ title: "إدارة قواعد المعرفة", url: `${context.dashboardUrl}/dashboard/knowledge` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:knowledge.list:1", title: "تحديث" }]],
  });
}

export async function renderContent(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "content:read");
  const rows = await db().select({
    title: sitePages.title,
    slug: sitePages.slug,
    status: sitePages.status,
    publishedAt: sitePages.publishedAt,
    updatedAt: sitePages.updatedAt,
  }).from(sitePages).where(and(
    eq(sitePages.organizationId, context.actor.organizationId),
    isNull(sitePages.deletedAt),
  )).orderBy(desc(sitePages.updatedAt)).limit(20);
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← المحتوى والمعرفة ← المحتوى",
    title: "صفحات المحتوى الفعلية",
    items: rows.map((row, index) => `${index + 1}. ${row.title}\nالمسار: ${row.slug}\nالحالة: ${row.status}\nنُشر: ${row.publishedAt?.toISOString() ?? "لم يُنشر"}\nآخر تحديث: ${row.updatedAt.toISOString()}`),
    emptyText: "لا توجد صفحات محتوى متاحة.",
    buttonRows: [[{ title: "فتح إدارة المحتوى", url: `${context.dashboardUrl}/dashboard/content` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:content.list:1", title: "تحديث" }]],
  });
}

export async function renderRepositories(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "integrations:read");
  const [integration] = await db().select().from(integrations).where(and(
    eq(integrations.organizationId, context.actor.organizationId),
    eq(integrations.kind, "github"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).orderBy(desc(integrations.lastVerifiedAt)).limit(1);
  if (!integration) {
    return sendTelegramEmptyState({
      chatId: context.update.chatId,
      messageId: messageId(context),
      title: "الرئيسية ← القنوات والتكاملات ← GitHub والمستودعات",
      text: "لا يوجد اتصال GitHub متحقق. لا تُدخل أي توكن داخل Telegram.",
      buttonRows: [[{ title: "إعداد GitHub في الموقع", url: `${context.dashboardUrl}/dashboard/integrations` }], [{ id: "nav:home", title: "الرئيسية" }]],
    });
  }
  const token = decryptSecret(integration.encryptedToken, `integration:${context.actor.organizationId}`);
  const repositories = await listGitHubRepositories(token, 20);
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← القنوات والتكاملات ← GitHub والمستودعات",
    title: `المستودعات الحقيقية عبر ${integration.name}`,
    items: repositories.map((repo, index) => `${index + 1}. ${repo.full_name}\nالخصوصية: ${repo.private ? "خاص" : "عام"}\nالفرع الافتراضي: ${repo.default_branch}\nاللغة: ${repo.language ?? "غير محددة"}\nآخر تحديث: ${repo.updated_at}`),
    emptyText: "الاتصال متحقق لكنه لم يُرجع مستودعات متاحة للتوكن الحالي.",
    buttonRows: [[{ title: "فتح المستودعات في الموقع", url: `${context.dashboardUrl}/dashboard/repositories` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:repositories.list:1", title: "تحديث" }]],
  });
}

export async function renderMcp(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "mcp:read");
  const servers = await db().select({
    id: mcpServers.id,
    name: mcpServers.name,
    status: mcpServers.status,
    enabled: mcpServers.enabled,
    lastConnectedAt: mcpServers.lastConnectedAt,
    lastErrorCode: mcpServers.lastErrorCode,
  }).from(mcpServers).where(eq(mcpServers.organizationId, context.actor.organizationId)).orderBy(asc(mcpServers.name));
  const toolCounts = new Map<string, number>();
  for (const server of servers) {
    const [total] = await db().select({ value: count() }).from(mcpTools).where(and(
      eq(mcpTools.organizationId, context.actor.organizationId),
      eq(mcpTools.serverId, server.id),
      eq(mcpTools.enabled, true),
    ));
    toolCounts.set(server.id, Number(total?.value ?? 0));
  }
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← التشغيل ← MCP",
    title: "خوادم MCP الفعلية",
    items: servers.map((server, index) => `${index + 1}. ${server.name}\nالحالة: ${server.status}\nمفعّل: ${server.enabled ? "نعم" : "لا"}\nالأدوات المفعلة: ${toolCounts.get(server.id) ?? 0}\nآخر اتصال: ${server.lastConnectedAt?.toISOString() ?? "لم يتصل"}${server.lastErrorCode ? `\nرمز الخطأ: ${server.lastErrorCode}` : ""}`),
    emptyText: "لا توجد خوادم MCP مسجلة.",
    buttonRows: [[{ title: "إدارة MCP في الموقع", url: `${context.dashboardUrl}/dashboard/mcp` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:mcp.list:1", title: "تحديث" }]],
  });
}

export async function renderBrowserTasks(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "browser_tasks:read");
  const rows = await db().select({
    instruction: browserTasks.instruction,
    status: browserTasks.status,
    riskLevel: browserTasks.riskLevel,
    currentStep: browserTasks.currentStep,
    siteName: siteConnections.name,
    siteDomain: siteConnections.siteDomain,
    errorCode: browserTasks.errorCode,
    createdAt: browserTasks.createdAt,
  }).from(browserTasks)
    .innerJoin(siteConnections, eq(siteConnections.id, browserTasks.siteConnectionId))
    .where(eq(browserTasks.organizationId, context.actor.organizationId))
    .orderBy(desc(browserTasks.createdAt)).limit(15);
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← التشغيل ← مهام المتصفح",
    title: "مهام المتصفح الفعلية",
    items: rows.map((row, index) => `${index + 1}. ${row.siteName} (${row.siteDomain})\nالمهمة: ${row.instruction}\nالحالة: ${row.status}\nالمخاطر: ${row.riskLevel}\nالخطوة الحالية: ${row.currentStep}${row.errorCode ? `\nرمز الخطأ: ${row.errorCode}` : ""}\nأضيفت: ${row.createdAt.toISOString()}`),
    emptyText: "لا توجد مهام متصفح في المؤسسة.",
    buttonRows: [[{ title: "فتح مهام المتصفح", url: `${context.dashboardUrl}/dashboard/browser` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:browser.list:1", title: "تحديث" }]],
  });
}

export async function renderSandbox(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "sandbox:read");
  const [workspaces, executions] = await Promise.all([
    db().select({
      name: sandboxWorkspaces.name,
      status: sandboxWorkspaces.status,
      provider: sandboxWorkspaces.provider,
      networkMode: sandboxWorkspaces.networkMode,
      lastActivityAt: sandboxWorkspaces.lastActivityAt,
      errorCode: sandboxWorkspaces.errorCode,
    }).from(sandboxWorkspaces).where(eq(sandboxWorkspaces.organizationId, context.actor.organizationId))
      .orderBy(desc(sandboxWorkspaces.updatedAt)).limit(10),
    db().select({
      commandSummary: sandboxExecutions.commandSummary,
      status: sandboxExecutions.status,
      riskLevel: sandboxExecutions.riskLevel,
      exitCode: sandboxExecutions.exitCode,
      errorCode: sandboxExecutions.errorCode,
      createdAt: sandboxExecutions.createdAt,
    }).from(sandboxExecutions).where(eq(sandboxExecutions.organizationId, context.actor.organizationId))
      .orderBy(desc(sandboxExecutions.createdAt)).limit(10),
  ]);
  const items = [
    ...workspaces.map((row, index) => `مساحة ${index + 1}: ${row.name}\nالحالة: ${row.status}\nالمزود: ${row.provider}\nالشبكة: ${row.networkMode}\nآخر نشاط: ${row.lastActivityAt.toISOString()}${row.errorCode ? `\nرمز الخطأ: ${row.errorCode}` : ""}`),
    ...executions.map((row, index) => `تنفيذ ${index + 1}: ${row.commandSummary}\nالحالة: ${row.status}\nالمخاطر: ${row.riskLevel}\nرمز الخروج: ${row.exitCode ?? "لم يكتمل"}${row.errorCode ? `\nرمز الخطأ: ${row.errorCode}` : ""}\nأضيف: ${row.createdAt.toISOString()}`),
  ];
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← التشغيل ← بيئة التنفيذ",
    title: "بيئة التنفيذ الفعلية",
    items,
    emptyText: "لا توجد مساحات أو عمليات تنفيذ في المؤسسة.",
    buttonRows: [[{ title: "فتح بيئة التنفيذ", url: `${context.dashboardUrl}/dashboard/sandbox` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:sandbox.list:1", title: "تحديث" }]],
  });
}

export async function renderNotifications(context: TelegramActionContext) {
  const rows = await db().select({
    id: internalNotifications.id,
    title: internalNotifications.title,
    body: internalNotifications.body,
    readAt: internalNotifications.readAt,
    createdAt: internalNotifications.createdAt,
  }).from(internalNotifications).where(and(
    eq(internalNotifications.organizationId, context.actor.organizationId),
    eq(internalNotifications.userId, context.actor.userId),
  )).orderBy(desc(internalNotifications.createdAt)).limit(20);
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← الإشعارات",
    title: "الإشعارات الفعلية",
    items: rows.map((row, index) => `${index + 1}. ${row.readAt ? "✓" : "●"} ${row.title}\n${row.body}\n${row.createdAt.toISOString()}`),
    emptyText: "لا توجد إشعارات لحسابك.",
    buttonRows: [
      ...(rows.some((row) => !row.readAt) ? [[{ id: "notifications:read", title: "تعليم الكل كمقروء" }]] : []),
      [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:notifications.list:1", title: "تحديث" }],
    ],
  });
}

export async function markNotificationsRead(context: TelegramActionContext) {
  await db().update(internalNotifications).set({ readAt: new Date() }).where(and(
    eq(internalNotifications.organizationId, context.actor.organizationId),
    eq(internalNotifications.userId, context.actor.userId),
    isNull(internalNotifications.readAt),
  ));
  return renderNotifications(context);
}

export async function renderAudit(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "audit:read");
  const rows = await db().select({
    action: auditLogs.action,
    actorType: auditLogs.actorType,
    resourceType: auditLogs.resourceType,
    createdAt: auditLogs.createdAt,
  }).from(auditLogs).where(eq(auditLogs.organizationId, context.actor.organizationId))
    .orderBy(desc(auditLogs.createdAt)).limit(20);
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← سجل التدقيق",
    title: "آخر أحداث التدقيق الفعلية",
    items: rows.map((row, index) => `${index + 1}. ${row.action}\nالفاعل: ${row.actorType}\nالمورد: ${row.resourceType}\nالوقت: ${row.createdAt.toISOString()}`),
    emptyText: "لا توجد أحداث تدقيق في المؤسسة.",
    buttonRows: [[{ title: "فتح سجل التدقيق", url: `${context.dashboardUrl}/dashboard/audit` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:audit.list:1", title: "تحديث" }]],
  });
}

export async function renderPlatformHealth(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "platform:read");
  const health = await checkDatabase();
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← صحة المنصة",
    title: "صحة المنصة الحالية",
    description: [
      `قاعدة البيانات: ${health.ok ? "متاحة" : "غير متاحة"}`,
      `زمن الاستجابة: ${health.latencyMs} مللي ثانية`,
      `جداول المخطط المتحققة: ${health.schemaTables}`,
      `العامل الخلفي: ${health.worker.active ? "نشط" : "غير نشط"}`,
      `آخر نبضة للعامل: ${health.worker.lastSeenAt ?? "غير متاحة"}`,
    ].join("\n"),
    buttonRows: [[{ id: "nav:home", title: "الرئيسية" }, { id: "cap:health.view:1", title: "تحديث" }]],
  });
}

export async function renderMembers(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "members:read");
  const rows = await db().select({
    name: users.name,
    email: users.email,
    role: organizationMembers.role,
    joinedAt: organizationMembers.createdAt,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, context.actor.organizationId))
    .orderBy(asc(users.name), asc(users.email));
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← الأعضاء والصلاحيات",
    title: "أعضاء المؤسسة الفعليون",
    items: rows.map((row, index) => `${index + 1}. ${row.name ?? row.email}\nالدور: ${row.role}\nتاريخ الانضمام: ${row.joinedAt.toISOString()}`),
    emptyText: "لا يوجد أعضاء ظاهرون.",
    buttonRows: [[{ title: "إدارة الأعضاء", url: `${context.dashboardUrl}/dashboard/members` }], [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:members.list:1", title: "تحديث" }]],
  });
}
