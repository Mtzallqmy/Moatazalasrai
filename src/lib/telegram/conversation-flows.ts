import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations } from "@/db/schema";
import { executeAgentRun } from "@/lib/agents/runtime";
import { createConversationForAgent } from "@/lib/chat/conversation-service";
import { ApiError } from "@/lib/http/api";
import { sendTelegramChatAction } from "@/lib/integrations/telegram";
import { assertTelegramCapability } from "./capability-registry";
import { listTelegramAgents } from "./agent-flows";
import { sendTelegramError, sendTelegramMenu, sendTelegramText } from "./message-renderer";
import { listTelegramBrowserTasks, listTelegramSandboxRuntime } from "./runtime-flows";
import { getTelegramSession, setTelegramConversation } from "./session-service";

type ConversationContext = {
  token: string;
  chatId: string;
  telegramUserId: string;
  userId: string;
  organizationId: string;
};

async function selectedPublishedAgent(input: ConversationContext) {
  const session = await getTelegramSession(input.telegramUserId);
  if (!session?.selectedAgentId) return { session, agent: null };
  const [agent] = await db().select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(and(
    eq(agents.id, session.selectedAgentId),
    eq(agents.organizationId, input.organizationId),
  )).limit(1);
  return { session, agent: agent?.status === "published" ? agent : null };
}

export async function startTelegramConversation(input: ConversationContext) {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "chat.start",
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_CAPABILITY_DENIED", "ميزة المحادثة غير متاحة لحسابك.");
  const { session, agent } = await selectedPublishedAgent(input);
  if (!agent) {
    await listTelegramAgents({ ...input, mode: "select" });
    return;
  }

  if (session?.selectedConversationId) {
    const [conversation] = await db().select({ id: conversations.id, status: conversations.status }).from(conversations).where(and(
      eq(conversations.id, session.selectedConversationId),
      eq(conversations.organizationId, input.organizationId),
      eq(conversations.agentId, agent.id),
    )).limit(1);
    if (conversation?.status === "active") {
      await sendTelegramMenu({
        token: input.token,
        chatId: input.chatId,
        title: `لديك محادثة نشطة مع «${agent.name}».`,
        buttonRows: [
          [{ id: "chat:continue", title: "متابعة المحادثة" }, { id: "chat:new:confirm", title: "محادثة جديدة" }],
          [{ id: "agents:select", title: "اختيار وكيل آخر" }, { id: "nav:home", title: "الرئيسية" }],
        ],
      });
      return;
    }
  }

  await createAndSelectConversation(input, agent.id, agent.name);
}

export async function createAndSelectConversation(input: ConversationContext, agentId: string, agentName?: string) {
  const result = await createConversationForAgent({ userId: input.userId, organizationId: input.organizationId }, agentId);
  await setTelegramConversation({
    telegramUserId: input.telegramUserId,
    conversationId: result.conversation.id,
    agentId: result.agent.id,
  });
  await sendTelegramText({
    token: input.token,
    chatId: input.chatId,
    text: `بدأت محادثة جديدة مع «${agentName ?? result.agent.name}». أرسل رسالتك التالية وسيتم حفظها في نفس محادثات الموقع.`,
    buttonRows: [[{ id: "agents:select", title: "اختيار وكيل آخر" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function handleTelegramConversationCallback(input: ConversationContext & { action: string }) {
  if (input.action === "browser:list") {
    await listTelegramBrowserTasks(input);
    return true;
  }
  if (input.action === "sandbox:list") {
    await listTelegramSandboxRuntime(input);
    return true;
  }
  if (input.action === "chat:continue") {
    const { agent } = await selectedPublishedAgent(input);
    if (!agent) {
      await listTelegramAgents({ ...input, mode: "select" });
      return true;
    }
    await sendTelegramText({ token: input.token, chatId: input.chatId, text: `أرسل رسالتك إلى «${agent.name}».` });
    return true;
  }
  if (input.action === "chat:new:confirm") {
    const { agent } = await selectedPublishedAgent(input);
    if (!agent) {
      await listTelegramAgents({ ...input, mode: "select" });
      return true;
    }
    await createAndSelectConversation(input, agent.id, agent.name);
    return true;
  }
  return false;
}

function presentRuntimeError(error: unknown) {
  if (!(error instanceof ApiError)) return "حدث فشل مؤقت أثناء تشغيل الوكيل. حاول مجددًا لاحقًا.";
  const known: Record<string, string> = {
    AGENT_UNAVAILABLE: "الوكيل غير منشور أو لم يعد متاحًا.",
    PROVIDER_NOT_CONFIGURED: "لا يوجد مزود صالح مرتبط بالوكيل.",
    PROVIDER_UNAVAILABLE: "المزود غير متاح حاليًا.",
    MODEL_UNAVAILABLE: "النموذج المحدد غير متاح حاليًا.",
    RUN_LIMIT_REACHED: "تم الوصول إلى حد الاستخدام المسموح.",
    PROVIDER_EMPTY_OUTPUT: "أعاد المزود استجابة فارغة، ولم يتم إرسالها.",
    TOOL_APPROVAL_REQUIRED: "يتطلب الإجراء موافقة قبل متابعة التشغيل.",
  };
  return known[error.code] ?? error.message;
}

export async function sendTelegramConversationMessage(input: ConversationContext & { text: string; requestId: string }) {
  const text = input.text.trim();
  if (!text) throw new ApiError(422, "TELEGRAM_EMPTY_INPUT", "لا يمكن إرسال رسالة فارغة.");
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "chat.start",
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_CAPABILITY_DENIED", "ميزة المحادثة غير متاحة لحسابك.");
  const session = await getTelegramSession(input.telegramUserId);
  if (!session?.selectedAgentId || !session.selectedConversationId) {
    await startTelegramConversation(input);
    return;
  }
  const [conversation] = await db().select({
    id: conversations.id,
    agentId: conversations.agentId,
    status: conversations.status,
  }).from(conversations).where(and(
    eq(conversations.id, session.selectedConversationId),
    eq(conversations.organizationId, input.organizationId),
    eq(conversations.createdByUserId, input.userId),
  )).limit(1);
  if (!conversation || conversation.status !== "active" || conversation.agentId !== session.selectedAgentId) {
    await startTelegramConversation(input);
    return;
  }

  await sendTelegramChatAction({ token: input.token, chatId: input.chatId, action: "typing" }).catch(() => undefined);
  try {
    const result = await executeAgentRun({
      organizationId: input.organizationId,
      userId: input.userId,
      conversationAuthorized: true,
      agentId: conversation.agentId,
      message: text,
      conversationId: conversation.id,
      requestId: input.requestId,
    });
    if ("approvalId" in result && result.approvalId) {
      await sendTelegramMenu({
        token: input.token,
        chatId: input.chatId,
        title: "توقف التشغيل لأن أداة تحتاج إلى موافقة حقيقية. افتح قسم الموافقات لمراجعة الطلب.",
        buttonRows: [[{ id: "approvals:list", title: "فتح الموافقات" }], [{ id: "nav:home", title: "الرئيسية" }]],
      });
      return;
    }
    const content = result.assistantMessage?.content?.trim();
    if (!content) throw new ApiError(502, "PROVIDER_EMPTY_OUTPUT", "أعاد المزود استجابة فارغة.");
    await sendTelegramText({ token: input.token, chatId: input.chatId, text: content });
  } catch (error) {
    await sendTelegramError({
      token: input.token,
      chatId: input.chatId,
      text: presentRuntimeError(error),
      referenceId: input.requestId,
      buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
    });
  }
}
