import { ApiError } from "@/lib/http/api";
import { createConversation, getWritableConversation, sendConversationMessage } from "@/lib/chat/service";
import { getAccessibleAgent, listRunnableAgents } from "@/lib/agents/service";
import {
  beginTelegramFlow,
  completeTelegramFlow,
  updateTelegramSession,
} from "@/lib/telegram/session-service";
import {
  sendTelegramEmptyState,
  sendTelegramMenu,
  sendTelegramText,
  sendTelegramTyping,
} from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";

function messageId(context: TelegramActionContext) {
  return context.update.kind === "callback_query" ? context.update.messageId : undefined;
}

export async function openConversation(context: TelegramActionContext) {
  if (context.session.selectedAgentId) {
    try {
      const agent = await getAccessibleAgent(context.actor, context.session.selectedAgentId);
      if (agent.status === "published" && agent.ready) {
        if (context.session.selectedConversationId) {
          try {
            const conversation = await getWritableConversation({
              actor: context.actor,
              conversationId: context.session.selectedConversationId,
              expectedAgentId: agent.id,
            });
            return sendTelegramMenu({
              chatId: context.update.chatId,
              messageId: messageId(context),
              path: "الرئيسية ← العمل الذكي ← المحادثة",
              title: `المحادثة مع ${agent.name}`,
              description: `المحادثة النشطة: ${conversation.title ?? "محادثة بلا عنوان بعد"}\nاختر المتابعة أو ابدأ محادثة جديدة.",
              buttonRows: [
                [{ id: "chat:resume", title: "متابعة المحادثة" }],
                [{ id: "chat:new", title: "محادثة جديدة" }, { id: "chat:agents", title: "اختيار وكيل آخر" }],
                [{ id: "nav:home", title: "الرئيسية" }],
              ],
            });
          } catch {
            context.session = await updateTelegramSession(context.session, { selectedConversationId: null });
          }
        }
        return sendTelegramMenu({
          chatId: context.update.chatId,
          messageId: messageId(context),
          path: "الرئيسية ← العمل الذكي ← المحادثة",
          title: `الوكيل المختار: ${agent.name}`,
          description: "لا توجد محادثة نشطة صالحة. ابدأ محادثة جديدة أو اختر وكيلًا آخر.",
          buttonRows: [
            [{ id: "chat:new", title: "محادثة جديدة" }],
            [{ id: "chat:agents", title: "اختيار وكيل آخر" }, { id: "nav:home", title: "الرئيسية" }],
          ],
        });
      }
    } catch {
      context.session = await updateTelegramSession(context.session, {
        selectedAgentId: null,
        selectedConversationId: null,
      });
    }
  }

  const agents = await listRunnableAgents(context.actor);
  if (!agents.length) {
    const all = await import("@/lib/agents/service").then(({ listAccessibleAgents }) =>
      listAccessibleAgents({ actor: context.actor, page: 1, limit: 50 }));
    const hasDraft = all.rows.some((agent) => agent.status !== "published");
    const hasProviderFailure = all.rows.some((agent) => agent.unavailableReason === "PROVIDER_UNAVAILABLE");
    const hasModelFailure = all.rows.some((agent) => agent.unavailableReason === "MODEL_UNAVAILABLE");
    const reason = all.rows.length === 0
      ? "لا يوجد أي وكيل في المؤسسة."
      : hasProviderFailure
        ? "يوجد وكيل منشور، لكن مزوده غير متصل أو غير صالح."
        : hasModelFailure
          ? "يوجد وكيل منشور، لكن النموذج غير متاح."
          : hasDraft
            ? "الوكلاء الموجودون ما زالوا مسودات ولا يمكن تشغيلهم."
            : "لا يوجد وكيل يمكنك تشغيله بصلاحياتك الحالية.";
    return sendTelegramEmptyState({
      chatId: context.update.chatId,
      messageId: messageId(context),
      title: "الرئيسية ← العمل الذكي ← المحادثة",
      text: reason,
      buttonRows: [
        [{ id: "cap:agents.list:1", title: "فتح الوكلاء" }],
        [{ id: "nav:home", title: "الرئيسية" }],
      ],
    });
  }

  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← العمل الذكي ← المحادثة ← اختيار وكيل",
    title: "اختر وكيلًا جاهزًا للمحادثة",
    description: "القائمة محملة من الوكلاء المنشورين ذوي المزود والنموذج الصالحين.",
    buttonRows: [
      ...agents.map((agent) => [{ id: `agt:s:${agent.id}`, title: agent.name.slice(0, 55) }]),
      [{ id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function startNewConversation(context: TelegramActionContext) {
  if (!context.session.selectedAgentId) return openConversation(context);
  const conversation = await createConversation({ actor: context.actor, agentId: context.session.selectedAgentId });
  context.session = await beginTelegramFlow(
    await updateTelegramSession(context.session, { selectedConversationId: conversation.id }),
    { flow: "conversation.chat", step: "message", state: {} },
  );
  const agent = await getAccessibleAgent(context.actor, context.session.selectedAgentId);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← العمل الذكي ← المحادثة",
    title: `بدأت محادثة حقيقية مع ${agent.name}`,
    description: "أرسل رسالتك التالية. ستُحفظ الرسالة والنتيجة في نفس محادثات لوحة الموقع.",
    buttonRows: [[{ id: "chat:stop", title: "إنهاء وضع المحادثة" }], [{ id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function resumeConversation(context: TelegramActionContext) {
  if (!context.session.selectedConversationId) return openConversation(context);
  const conversation = await getWritableConversation({ actor: context.actor, conversationId: context.session.selectedConversationId });
  context.session = await beginTelegramFlow(context.session, {
    flow: "conversation.chat",
    step: "message",
    state: {},
  });
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← العمل الذكي ← المحادثة",
    title: `متابعة المحادثة مع ${conversation.agentName}`,
    description: "أرسل رسالتك التالية الآن.",
    buttonRows: [[{ id: "chat:stop", title: "إنهاء وضع المحادثة" }], [{ id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function stopConversationMode(context: TelegramActionContext) {
  context.session = await completeTelegramFlow(context.session);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← العمل الذكي ← المحادثة",
    title: "تم إنهاء وضع المحادثة",
    description: "بقي اختيار الوكيل والمحادثة محفوظًا ويمكن متابعته لاحقًا.",
    buttonRows: [[{ id: "chat:open", title: "فتح المحادثة" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function handleConversationText(
  context: TelegramActionContext,
  text: string,
  attachmentIds: string[] = [],
) {
  if (context.session.activeFlow !== "conversation.chat" || context.session.currentStep !== "message") return false;
  if (!context.session.selectedConversationId) throw new ApiError(409, "TELEGRAM_SESSION_MISSING", "لا توجد محادثة مختارة.");
  await sendTelegramTyping(context.update.chatId).catch(() => undefined);
  const requestId = `telegram:${context.session.id}:${context.update.updateId}`;
  const result = await sendConversationMessage({
    actor: context.actor,
    conversationId: context.session.selectedConversationId,
    text,
    requestId,
    clientRequestId: requestId,
    attachmentIds,
  });
  if ("duplicate" in result && result.duplicate) {
    if (result.run.status === "completed" && result.run.output?.trim()) {
      await sendTelegramText({ chatId: context.update.chatId, text: result.run.output.trim() });
      return true;
    }
    await sendTelegramText({
      chatId: context.update.chatId,
      text: `تم استقبال الرسالة سابقًا. حالة التشغيل الحالية: ${result.run.status}.`,
      buttonRows: [[{ id: "cap:runs.list:1", title: "عرض عمليات التشغيل" }]],
    });
    return true;
  }
  if (result.run?.status === "waiting_approval") {
    await sendTelegramMenu({
      chatId: context.update.chatId,
      path: "الرئيسية ← المحادثة ← موافقة مطلوبة",
      title: "توقف التشغيل بانتظار موافقة حقيقية",
      description: "لم تُنفذ الأداة بعد. افتح الموافقات لمراجعة التفاصيل واتخاذ القرار.",
      buttonRows: [[{ id: "cap:approvals.list:1", title: "فتح الموافقات" }], [{ id: "chat:stop", title: "إنهاء المحادثة" }]],
    });
    return true;
  }
  const output = result.assistantMessage?.content?.trim() || result.run?.output?.trim();
  if (!output) throw new ApiError(502, "PROVIDER_EMPTY_OUTPUT", "لم يُرجع المزود محتوى صالحًا.");
  await sendTelegramText({
    chatId: context.update.chatId,
    text: output,
    buttonRows: [[{ id: "chat:stop", title: "إنهاء المحادثة" }, { id: "chat:agents", title: "تغيير الوكيل" }]],
  });
  return true;
}
