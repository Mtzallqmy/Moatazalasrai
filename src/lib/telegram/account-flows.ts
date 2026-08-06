import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, organizationMembers, organizations, users } from "@/db/schema";
import { telegramFeaturePermissions } from "@/db/telegram-platform-schema";
import { ApiError } from "@/lib/http/api";
import { unlinkTelegramAccount } from "@/lib/integrations/telegram-platform";
import {
  actorForTelegramSession,
  selectTelegramOrganization,
} from "@/lib/telegram/session-service";
import { sendTelegramMenu } from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";

const featureLabels: Record<string, string> = {
  "telegram.chat": "المحادثة",
  "telegram.agents": "الوكلاء والفرق والتشغيل",
  "telegram.files": "الملفات والمحتوى",
  "telegram.images": "الصور",
  "telegram.audio": "الصوت",
  "telegram.video": "الفيديو",
  "telegram.notifications": "الإشعارات",
  "telegram.admin_commands": "قدرات الإدارة والتشخيص",
};

function messageId(context: TelegramActionContext) {
  return context.update.kind === "callback_query" ? context.update.messageId : undefined;
}

export async function renderAccount(context: TelegramActionContext) {
  const [[profile], [organization], [membership], permissions, [agent], [conversation]] = await Promise.all([
    db().select({ name: users.name, email: users.email }).from(users).where(eq(users.id, context.actor.userId)).limit(1),
    db().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, context.actor.organizationId)).limit(1),
    db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, context.actor.organizationId),
      eq(organizationMembers.userId, context.actor.userId),
    )).limit(1),
    db().select({ featureKey: telegramFeaturePermissions.featureKey }).from(telegramFeaturePermissions).where(and(
      eq(telegramFeaturePermissions.userId, context.actor.userId),
      eq(telegramFeaturePermissions.organizationId, context.actor.organizationId),
      eq(telegramFeaturePermissions.enabled, true),
    )).orderBy(asc(telegramFeaturePermissions.featureKey)),
    context.session.selectedAgentId
      ? db().select({ name: agents.name, status: agents.status }).from(agents).where(and(
          eq(agents.id, context.session.selectedAgentId),
          eq(agents.organizationId, context.actor.organizationId),
        )).limit(1)
      : Promise.resolve([]),
    context.session.selectedConversationId
      ? db().select({ title: conversations.title, status: conversations.status }).from(conversations).where(and(
          eq(conversations.id, context.session.selectedConversationId),
          eq(conversations.organizationId, context.actor.organizationId),
        )).limit(1)
      : Promise.resolve([]),
  ]);
  if (!profile || !organization || !membership) throw new ApiError(403, "ORGANIZATION_MEMBERSHIP_REQUIRED", "تعذر تحميل حساب المؤسسة.");
  const displayName = profile.name?.trim() || profile.email.split("@")[0] || "مستخدم المنصة";
  const telegramName = context.account.telegramUsername
    ? `@${context.account.telegramUsername}`
    : [context.account.telegramFirstName, context.account.telegramLastName].filter(Boolean).join(" ") || "حساب Telegram مرتبط";
  const enabled = permissions.length
    ? permissions.map((permission) => `• ${featureLabels[permission.featureKey] ?? permission.featureKey}`).join("\n")
    : "لا توجد ميزات Telegram مفعلة.";
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← الحساب",
    title: displayName,
    description: [
      `المؤسسة الحالية: ${organization.name}`,
      `الدور: ${membership.role}`,
      `Telegram: ${telegramName}`,
      `تاريخ الربط: ${context.account.linkedAt.toISOString()}`,
      `آخر نشاط: ${context.account.lastSeenAt.toISOString()}`,
      `الوكيل المختار: ${agent?.name ?? "لا يوجد"}${agent ? ` (${agent.status})` : ""}`,
      `المحادثة النشطة: ${conversation?.title ?? (conversation ? "بلا عنوان" : "لا توجد")}`,
      "",
      "الميزات المفعلة:",
      enabled,
    ].join("\n"),
    buttonRows: [
      [{ id: "account:organizations", title: "اختيار المؤسسة" }],
      [{ id: "account:unlink", title: "فصل حساب Telegram" }],
      [{ id: "nav:home", title: "الرئيسية" }, { id: "cap:account.view:1", title: "تحديث" }],
    ],
  });
}

export async function renderOrganizations(context: TelegramActionContext) {
  const rows = await db().select({
    id: organizations.id,
    name: organizations.name,
    role: organizationMembers.role,
  }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, context.account.userId))
    .orderBy(asc(organizations.name));
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← الحساب ← المؤسسة",
    title: "اختر المؤسسة النشطة في Telegram",
    description: "سيُتحقق من العضوية والصلاحيات في كل طلب، ولن تُستخدم مؤسسة قديمة بصمت.",
    buttonRows: [
      ...rows.map((row) => [{
        id: `org:s:${row.id}`,
        title: `${row.id === context.actor.organizationId ? "✓ " : ""}${row.name} — ${row.role}`.slice(0, 60),
      }]),
      [{ id: "cap:account.view:1", title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function chooseOrganization(context: TelegramActionContext, organizationId: string) {
  const [membership] = await db().select({ role: organizationMembers.role, name: organizations.name })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, context.account.userId),
    )).limit(1);
  if (!membership) throw new ApiError(403, "ORGANIZATION_MEMBERSHIP_REQUIRED", "لست عضوًا في المؤسسة المحددة.");
  context.session = await selectTelegramOrganization(context.session, organizationId);
  context.actor = await actorForTelegramSession(context.session);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← الحساب ← المؤسسة",
    title: `تم اختيار مؤسسة ${membership.name}`,
    description: "تم مسح اختيارات الوكيل والمحادثة السابقة لمنع عبور البيانات بين المؤسسات.",
    buttonRows: [[{ id: "nav:home", title: "فتح الرئيسية" }], [{ id: "cap:account.view:1", title: "الحساب" }]],
  });
}

export function confirmUnlink(context: TelegramActionContext) {
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← الإدارة ← الحساب ← فصل الحساب",
    title: "تأكيد فصل حساب Telegram",
    description: "سيتم إبطال الرابط الحالي ولن تستطيع استخدام المنصة من هذا الحساب حتى إنشاء رمز جديد.",
    buttonRows: [[{ id: "account:unlink:confirm", title: "تأكيد الفصل" }], [{ id: "cap:account.view:1", title: "إلغاء" }]],
  });
}

export async function executeUnlink(context: TelegramActionContext) {
  await unlinkTelegramAccount({
    userId: context.account.userId,
    organizationId: context.account.organizationId,
    actorUserId: context.account.userId,
  });
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    title: "تم فصل حساب Telegram",
    description: "أنشئ رمز ربط جديدًا من إعدادات الموقع لإعادة الاتصال.",
    buttonRows: [[{ title: "فتح إعدادات Telegram", url: `${context.dashboardUrl}/dashboard/integrations` }]],
  });
}
