import { getAccessibleAgent, listAccessibleAgents } from "@/lib/application/agents";
import { listAccessibleConversations } from "@/lib/application/conversations";
import { ApiError } from "@/lib/http/api";
import { sendWhatsAppButtons, sendWhatsAppEmptyState, sendWhatsAppList, sendWhatsAppText } from "./message-renderer";
import { sessionState, updateWhatsAppSession } from "./session-service";
import type { WhatsAppRuntimeContext } from "./types";

const PAGE_SIZE = 8;

export async function openWhatsAppChat(context: WhatsAppRuntimeContext) {
  if (context.session.selectedAgentId) {
    try {
      const agent = await getAccessibleAgent({
        organizationId: context.identity.organizationId,
        role: context.identity.role,
        agentId: context.session.selectedAgentId,
        requirePublished: true,
      });
      await sendWhatsAppButtons({
        to: context.message.from,
        text: [
          `الوكيل المختار: ${agent.name}`,
          `المزود: ${agent.providerName}`,
          `النموذج: ${agent.model}`,
          context.session.selectedConversationId
            ? "توجد محادثة نشطة محفوظة لهذه الجلسة."
            : "لا توجد محادثة نشطة بعد.",
        ].join("\n"),
        actions: [
          { id: "wa.chat.continue", title: "متابعة الدردشة" },
          { id: "wa.chat.new", title: "محادثة جديدة" },
          { id: "wa.chat.choose", title: "اختيار وكيل" },
        ],
      });
      return;
    } catch {
      const next = await updateWhatsAppSession({
        session: context.session,
        selectedAgentId: null,
        selectedConversationId: null,
      });
      context.session = next;
    }
  }
  await chooseWhatsAppAgent(context, 0);
}

export async function chooseWhatsAppAgent(context: WhatsAppRuntimeContext, page: number) {
  const agents = await listAccessibleAgents({
    organizationId: context.identity.organizationId,
    role: context.identity.role,
    publishedOnly: true,
    limit: 100,
  });
  if (!agents.length) {
    const canManage = context.identity.permissions.has("agents:manage");
    await sendWhatsAppEmptyState({
      to: context.message.from,
      reason: "لا يوجد وكيل منشور وجاهز للدردشة. قد تكون الوكلاء مسودات، أو المزود غير متحقق، أو النموذج غير متاح.",
      action: canManage ? { id: "wa.agents.create", title: "إنشاء وكيل" } : undefined,
    });
    return;
  }
  const start = page * PAGE_SIZE;
  const actions = agents.slice(start, start + PAGE_SIZE).map((agent) => ({
    id: `wa.chat.agent:${agent.id}`,
    title: agent.name,
    description: `${agent.providerName} — ${agent.model}`,
  }));
  if (page > 0) actions.push({ id: `wa.chat.page:${page - 1}`, title: "السابق", description: "الصفحة السابقة" });
  if (start + PAGE_SIZE < agents.length) actions.push({ id: `wa.chat.page:${page + 1}`, title: "التالي", description: "الصفحة التالية" });
  await sendWhatsAppList({
    to: context.message.from,
    text: "اختر وكيلًا منشورًا. سيُحفظ الاختيار في جلسة WhatsApp فقط ولن يغيّر إعداد المؤسسة الدائم.",
    title: "اختيار الوكيل",
    buttonText: "عرض الوكلاء",
    actions,
  });
}

export async function activateWhatsAppChatAgent(context: WhatsAppRuntimeContext, agentId: string) {
  const agent = await getAccessibleAgent({
    organizationId: context.identity.organizationId,
    role: context.identity.role,
    agentId,
    requirePublished: true,
  });
  const next = await updateWhatsAppSession({
    session: context.session,
    activeFlow: null,
    currentStep: null,
    selectedAgentId: agent.id,
    selectedConversationId: null,
    state: { forceNewConversation: true },
  });
  context.session = next;
  await sendWhatsAppText({
    to: context.message.from,
    text: `تم اختيار «${agent.name}». أرسل رسالتك التالية؛ ستُنشأ محادثة حقيقية وتظهر في لوحة الموقع.`,
  });
}

export async function continueWhatsAppChat(context: WhatsAppRuntimeContext) {
  if (!context.session.selectedAgentId) {
    await chooseWhatsAppAgent(context, 0);
    return;
  }
  await sendWhatsAppText({
    to: context.message.from,
    text: "أرسل رسالتك الآن إلى الوكيل المختار.",
  });
}

export async function startNewWhatsAppConversation(context: WhatsAppRuntimeContext) {
  if (!context.session.selectedAgentId) {
    await chooseWhatsAppAgent(context, 0);
    return;
  }
  const next = await updateWhatsAppSession({
    session: context.session,
    selectedConversationId: null,
    state: { ...sessionState(context.session), forceNewConversation: true },
  });
  context.session = next;
  await sendWhatsAppText({
    to: context.message.from,
    text: "المحادثة التالية ستكون محادثة جديدة. أرسل أول رسالة الآن.",
  });
}

export async function listWhatsAppConversations(context: WhatsAppRuntimeContext, page: number) {
  const rows = await listAccessibleConversations({
    organizationId: context.identity.organizationId,
    userId: context.identity.userId,
    role: context.identity.role,
    limit: 100,
  });
  if (!rows.length) {
    await sendWhatsAppEmptyState({
      to: context.message.from,
      reason: "لا توجد محادثات فعلية متاحة لهذا الحساب.",
      action: { id: "wa.chat", title: "بدء محادثة" },
    });
    return;
  }
  const start = page * PAGE_SIZE;
  const actions = rows.slice(start, start + PAGE_SIZE).map((row) => ({
    id: `wa.conversation.view:${row.id}`,
    title: row.title?.trim() || row.agentName,
    description: `${row.agentName} — ${row.status} — ${row.model || "بدون نموذج"}`,
  }));
  if (page > 0) actions.push({ id: `wa.conversations.page:${page - 1}`, title: "السابق", description: "الصفحة السابقة" });
  if (start + PAGE_SIZE < rows.length) actions.push({ id: `wa.conversations.page:${page + 1}`, title: "التالي", description: "الصفحة التالية" });
  await sendWhatsAppList({
    to: context.message.from,
    text: `المحادثات الفعلية المتاحة (${rows.length}).`,
    title: "المحادثات",
    buttonText: "عرض المحادثات",
    actions,
  });
}

export async function showWhatsAppConversation(context: WhatsAppRuntimeContext, conversationId: string) {
  const rows = await listAccessibleConversations({
    organizationId: context.identity.organizationId,
    userId: context.identity.userId,
    role: context.identity.role,
    limit: 100,
  });
  const conversation = rows.find((row) => row.id === conversationId);
  if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة أو غير متاحة.");
  await sendWhatsAppButtons({
    to: context.message.from,
    text: [
      `المحادثة: ${conversation.title?.trim() || conversation.agentName}`,
      `الوكيل: ${conversation.agentName}`,
      `الحالة: ${conversation.status}`,
      `النموذج: ${conversation.model || "غير محدد"}`,
      `آخر رسالة: ${conversation.lastMessageAt?.toLocaleString("ar-SA") || "غير متاح"}`,
    ].join("\n"),
    actions: [
      { id: "wa.chat", title: "فتح الدردشة" },
      { id: "wa.conversations", title: "رجوع" },
    ],
  });
}
