import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, organizationMembers, organizations, users } from "@/db/schema";
import { resolveTelegramCapabilities } from "./capability-registry";
import { sendTelegramText } from "./message-renderer";
import { getTelegramSession } from "./session-service";

type AccountContext = {
  token: string;
  chatId: string;
  telegramUserId: string;
  userId: string;
  organizationId: string;
  telegramUsername?: string | null;
  linkedAt?: Date | null;
  lastSeenAt?: Date | null;
};

export async function showTelegramAccountStatus(input: AccountContext) {
  const [[account], [membership], session, capabilities] = await Promise.all([
    db().select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1),
    db().select({ role: organizationMembers.role, organizationName: organizations.name })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.userId, input.userId), eq(organizationMembers.organizationId, input.organizationId)))
      .limit(1),
    getTelegramSession(input.telegramUserId),
    resolveTelegramCapabilities({ userId: input.userId, organizationId: input.organizationId }),
  ]);

  let selectedAgentName: string | null = null;
  let conversationTitle: string | null = null;
  if (session?.selectedAgentId) {
    const [agent] = await db().select({ name: agents.name }).from(agents).where(and(
      eq(agents.id, session.selectedAgentId),
      eq(agents.organizationId, input.organizationId),
    )).limit(1);
    selectedAgentName = agent?.name ?? null;
  }
  if (session?.selectedConversationId) {
    const [conversation] = await db().select({ title: conversations.title }).from(conversations).where(and(
      eq(conversations.id, session.selectedConversationId),
      eq(conversations.organizationId, input.organizationId),
    )).limit(1);
    conversationTitle = conversation?.title ?? "محادثة نشطة";
  }

  const capabilityLabels = capabilities.map((capability) => `• ${capability.labelAr}`).join("\n") || "لا توجد قدرات تشغيلية متاحة.";
  await sendTelegramText({
    token: input.token,
    chatId: input.chatId,
    text: [
      "الحساب والحالة",
      `المستخدم: ${account?.name ?? account?.email ?? "غير متاح"}`,
      `المؤسسة: ${membership?.organizationName ?? "غير متاحة"}`,
      `الدور: ${membership?.role ?? "غير متاح"}`,
      `Telegram: ${input.telegramUsername ? `@${input.telegramUsername}` : "مرتبط"}`,
      input.linkedAt ? `تاريخ الربط: ${input.linkedAt.toLocaleString("ar-SA")}` : null,
      input.lastSeenAt ? `آخر نشاط: ${input.lastSeenAt.toLocaleString("ar-SA")}` : null,
      `الوكيل المختار: ${selectedAgentName ?? "لا يوجد"}`,
      `المحادثة النشطة: ${conversationTitle ?? "لا توجد"}`,
      "",
      "القدرات المتاحة فعليًا:",
      capabilityLabels,
    ].filter((value) => value !== null).join("\n"),
    buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
  });
}
