import { z } from "zod";
import {
  createAgent,
  getAccessibleAgent,
  listAccessibleAgents,
  listVerifiedAgentProviders,
} from "@/lib/agents/service";
import { actorCan } from "@/lib/auth/actor-authorization";
import { ApiError } from "@/lib/http/api";
import {
  advanceTelegramFlow,
  beginTelegramFlow,
  completeTelegramFlow,
  updateTelegramSession,
} from "@/lib/telegram/session-service";
import {
  sendTelegramEmptyState,
  sendTelegramList,
  sendTelegramMenu,
  sendTelegramText,
} from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";

const nameSchema = z.string().trim().min(2).max(100);
const descriptionSchema = z.string().trim().max(1000);
const instructionsSchema = z.string().trim().min(1).max(30_000);

function callbackMessageId(context: TelegramActionContext) {
  return context.update.kind === "callback_query" ? context.update.messageId : undefined;
}

function navigation(page: number, pages: number) {
  const row = [] as Array<{ id: string; title: string }>;
  if (page > 1) row.push({ id: `cap:agents.list:${page - 1}`, title: "السابق" });
  if (page < pages) row.push({ id: `cap:agents.list:${page + 1}`, title: "التالي" });
  return row;
}

export async function renderAgents(context: TelegramActionContext) {
  const result = await listAccessibleAgents({ actor: context.actor, page: context.page, limit: 6 });
  const canManage = await actorCan(context.actor, "agents:manage");
  if (!result.rows.length) {
    return sendTelegramEmptyState({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      title: "الرئيسية ← العمل الذكي ← الوكلاء",
      text: canManage
        ? "لا يوجد وكيل في المؤسسة. يمكنك إنشاء وكيل بعد توفر مزود متحقق ونموذج حقيقي."
        : "لا يوجد وكيل متاح لحسابك، ولا تملك صلاحية إنشاء وكيل.",
      buttonRows: [
        ...(canManage ? [[{ id: "agt:c", title: "إنشاء وكيل" }]] : []),
        [{ id: "nav:home", title: "الرئيسية" }],
      ],
    });
  }
  const items = result.rows.map((agent, index) => {
    const status = agent.status === "published" ? "منشور" : agent.status === "draft" ? "مسودة" : "مؤرشف";
    const readiness = agent.ready ? "جاهز للتشغيل" : agent.unavailableReason === "AGENT_DRAFT"
      ? "غير قابل للتشغيل لأنه مسودة"
      : agent.unavailableReason === "PROVIDER_UNAVAILABLE"
        ? "المزود غير متاح"
        : "النموذج غير متاح";
    return `${(context.page - 1) * 6 + index + 1}. ${agent.name}\nالحالة: ${status} — ${readiness}\nالمزود: ${agent.providerName ?? "غير متاح"}\nالنموذج: ${agent.model}`;
  });
  const agentRows = result.rows.map((agent) => [{ id: `agt:v:${agent.id}`, title: agent.name.slice(0, 50) }]);
  const pager = navigation(result.pagination.page, result.pagination.pages);
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← العمل الذكي ← الوكلاء",
    title: `الوكلاء الفعليون — صفحة ${result.pagination.page} من ${Math.max(1, result.pagination.pages)}`,
    items,
    buttonRows: [
      ...agentRows,
      ...(pager.length ? [pager] : []),
      ...(canManage ? [[{ id: "agt:c", title: "إنشاء وكيل جديد" }]] : []),
      [{ id: "nav:home", title: "الرئيسية" }, { id: `cap:agents.list:${context.page}`, title: "تحديث" }],
    ],
  });
}

export async function renderAgentDetails(context: TelegramActionContext, agentId: string) {
  const agent = await getAccessibleAgent(context.actor, agentId);
  const canManage = await actorCan(context.actor, "agents:manage");
  const status = agent.status === "published" ? "منشور" : agent.status === "draft" ? "مسودة" : "مؤرشف";
  const readiness = agent.ready ? "جاهز" : agent.status !== "published"
    ? "غير قابل للتشغيل قبل النشر"
    : !agent.providerCredentialId || !agent.providerEnabled || agent.providerValidationStatus !== "verified"
      ? "المزود غير صالح"
      : "النموذج غير متاح";
  const buttons = [] as Array<Array<{ id?: string; title: string; url?: string }>>;
  if (agent.ready && agent.status === "published") {
    buttons.push([{ id: `agt:s:${agent.id}`, title: "اختيار للمحادثة" }]);
  }
  buttons.push([{
    title: canManage ? "فتح الوكيل وتعديله في الموقع" : "فتح الوكيل في الموقع",
    url: `${context.dashboardUrl}/dashboard/agents?agentId=${encodeURIComponent(agent.id)}`,
  }]);
  buttons.push([{ id: `cap:agents.list:${context.page}`, title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }]);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← العمل الذكي ← الوكلاء ← تفاصيل الوكيل",
    title: agent.name,
    description: [
      agent.description ? `الوصف: ${agent.description}` : "الوصف: غير محدد",
      `الحالة: ${status}`,
      `الجاهزية: ${readiness}`,
      `المزود: ${agent.providerName ?? "غير متاح"}`,
      `النموذج: ${agent.model}`,
      `آخر تحديث: ${agent.updatedAt.toISOString()}`,
    ].join("\n"),
    buttonRows: buttons,
  });
}

export async function selectAgentForTelegram(context: TelegramActionContext, agentId: string) {
  const agent = await getAccessibleAgent(context.actor, agentId);
  if (agent.status !== "published") throw new ApiError(422, "AGENT_DRAFT", "لا يمكن اختيار وكيل غير منشور.");
  if (!agent.ready) {
    if (!agent.providerCredentialId || !agent.providerEnabled || agent.providerValidationStatus !== "verified") {
      throw new ApiError(422, "PROVIDER_UNAVAILABLE", "مزود الوكيل غير متاح.");
    }
    throw new ApiError(422, "MODEL_UNAVAILABLE", "نموذج الوكيل غير متاح.");
  }
  context.session = await updateTelegramSession(context.session, {
    selectedAgentId: agent.id,
    selectedConversationId: null,
  });
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← العمل الذكي ← الوكلاء ← اختيار الوكيل",
    title: `تم اختيار ${agent.name}`,
    description: "سيُستخدم هذا الوكيل في محادثات Telegram الجديدة. لم تتغير إعدادات المؤسسة الدائمة.",
    buttonRows: [
      [{ id: "chat:new", title: "بدء محادثة جديدة" }],
      [{ id: `agt:v:${agent.id}`, title: "تفاصيل الوكيل" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function startAgentCreation(context: TelegramActionContext) {
  if (!await actorCan(context.actor, "agents:manage")) throw new ApiError(403, "FORBIDDEN", "لا تملك صلاحية إنشاء الوكلاء.");
  const providers = await listVerifiedAgentProviders(context.actor);
  if (!providers.length) {
    return sendTelegramEmptyState({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      title: "إنشاء وكيل",
      text: "لا يوجد مزود متحقق يحتوي على نموذج مكتشف. لن يتم إنشاء وكيل ناقص.",
      buttonRows: [
        [{ title: "إعداد المزودين في الموقع", url: `${context.dashboardUrl}/dashboard/providers` }],
        [{ id: "cap:agents.list:1", title: "رجوع" }],
      ],
    });
  }
  context.session = await beginTelegramFlow(context.session, {
    flow: "agent.create",
    step: "name",
    state: {},
  });
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
    title: "الخطوة 1 من 7 — اسم الوكيل",
    description: "أرسل اسمًا واضحًا للوكيل. لن تُفسر رسالتك التالية كأمر أو إلغاء.",
    buttonRows: [[{ id: "flow:cancel", title: "إلغاء" }]],
  });
}

export async function handleAgentCreationText(context: TelegramActionContext, rawText: string) {
  if (context.session.activeFlow !== "agent.create") return false;
  const state = { ...context.session.state } as Record<string, unknown>;
  if (context.session.currentStep === "name") {
    const parsed = nameSchema.safeParse(rawText);
    if (!parsed.success) throw new ApiError(400, "AGENT_NAME_INVALID", "اسم الوكيل يجب أن يكون بين حرفين و100 حرف.");
    state.name = parsed.data;
    context.session = await advanceTelegramFlow(context.session, { step: "description", state });
    await sendTelegramText({
      chatId: context.update.chatId,
      text: "الخطوة 2 من 7 — الوصف أو الهدف\n\nأرسل وصفًا مختصرًا، أو أرسل علامة - لتخطي الوصف.",
      buttonRows: [[{ id: "flow:cancel", title: "إلغاء" }]],
    });
    return true;
  }
  if (context.session.currentStep === "description") {
    const value = rawText.trim() === "-" ? "" : rawText;
    const parsed = descriptionSchema.safeParse(value);
    if (!parsed.success) throw new ApiError(400, "AGENT_DESCRIPTION_INVALID", "الوصف يتجاوز 1000 حرف.");
    state.description = parsed.data;
    context.session = await advanceTelegramFlow(context.session, { step: "instructions", state });
    await sendTelegramText({
      chatId: context.update.chatId,
      text: "الخطوة 3 من 7 — التعليمات الأساسية\n\nأرسل التعليمات التي تحدد دور الوكيل وطريقة عمله.",
      buttonRows: [[{ id: "flow:cancel", title: "إلغاء" }]],
    });
    return true;
  }
  if (context.session.currentStep === "instructions") {
    const parsed = instructionsSchema.safeParse(rawText);
    if (!parsed.success) throw new ApiError(400, "AGENT_INSTRUCTIONS_INVALID", "التعليمات مطلوبة ويجب ألا تتجاوز 30000 حرف.");
    const providers = await listVerifiedAgentProviders(context.actor);
    if (!providers.length) throw new ApiError(422, "PROVIDER_UNAVAILABLE", "لا يوجد مزود متحقق.");
    state.instructions = parsed.data;
    state.providers = providers.map((provider) => ({ id: provider.id, name: provider.name, models: provider.models }));
    context.session = await advanceTelegramFlow(context.session, { step: "provider", state });
    await sendTelegramMenu({
      chatId: context.update.chatId,
      path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
      title: "الخطوة 4 من 7 — اختيار المزود",
      description: "هذه القائمة محملة من المزودين المتحققين فعليًا في المؤسسة.",
      buttonRows: [
        ...providers.map((provider, index) => [{ id: `acf:p:${index}`, title: provider.name.slice(0, 55) }]),
        [{ id: "flow:cancel", title: "إلغاء" }],
      ],
    });
    return true;
  }
  throw new ApiError(409, "TELEGRAM_FLOW_STEP_INVALID", "الخطوة الحالية تنتظر اختيارًا من الأزرار.");
}

type ProviderState = { id: string; name: string; models: string[] };

export async function handleAgentCreationCallback(context: TelegramActionContext, action: string) {
  if (context.session.activeFlow !== "agent.create") throw new ApiError(409, "TELEGRAM_FLOW_MISSING", "لا توجد عملية إنشاء وكيل نشطة.");
  const state = { ...context.session.state } as Record<string, unknown>;
  if (action.startsWith("acf:p:") && context.session.currentStep === "provider") {
    const index = Number(action.slice("acf:p:".length));
    const providers = Array.isArray(state.providers) ? state.providers as ProviderState[] : [];
    const provider = providers[index];
    if (!provider?.id || !provider.models.length) throw new ApiError(409, "PROVIDER_UNAVAILABLE", "المزود المختار لم يعد متاحًا.");
    state.providerCredentialId = provider.id;
    state.providerName = provider.name;
    state.models = provider.models;
    context.session = await advanceTelegramFlow(context.session, { step: "model", state });
    return sendTelegramMenu({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
      title: "الخطوة 5 من 7 — اختيار النموذج",
      description: `المزود: ${provider.name}`,
      buttonRows: [
        ...provider.models.slice(0, 30).map((model, modelIndex) => [{ id: `acf:m:${modelIndex}`, title: model.slice(0, 55) }]),
        [{ id: "flow:cancel", title: "إلغاء" }],
      ],
    });
  }
  if (action.startsWith("acf:m:") && context.session.currentStep === "model") {
    const index = Number(action.slice("acf:m:".length));
    const models = Array.isArray(state.models) ? state.models.filter((value): value is string => typeof value === "string") : [];
    const model = models[index];
    if (!model) throw new ApiError(409, "MODEL_UNAVAILABLE", "النموذج المختار لم يعد متاحًا.");
    state.model = model;
    context.session = await advanceTelegramFlow(context.session, { step: "status", state });
    return sendTelegramMenu({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
      title: "الخطوة 6 من 7 — حالة الوكيل",
      description: "اختر مسودة أو نشر. النشر مسموح لأن المزود والنموذج تحققا فعليًا.",
      buttonRows: [
        [{ id: "acf:s:d", title: "حفظ كمسودة" }, { id: "acf:s:p", title: "إنشاء ونشر" }],
        [{ id: "flow:cancel", title: "إلغاء" }],
      ],
    });
  }
  if ((action === "acf:s:d" || action === "acf:s:p") && context.session.currentStep === "status") {
    state.publish = action === "acf:s:p";
    context.session = await advanceTelegramFlow(context.session, { step: "confirm", state });
    return sendTelegramMenu({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
      title: "الخطوة 7 من 7 — تأكيد الإنشاء",
      description: [
        `الاسم: ${String(state.name)}`,
        `الوصف: ${String(state.description || "بدون وصف")}`,
        `المزود: ${String(state.providerName)}`,
        `النموذج: ${String(state.model)}`,
        `الحالة: ${state.publish ? "منشور" : "مسودة"}`,
      ].join("\n"),
      buttonRows: [
        [{ id: "acf:ok", title: "تأكيد الإنشاء" }],
        [{ id: "flow:cancel", title: "إلغاء" }],
      ],
    });
  }
  if (action === "acf:ok" && context.session.currentStep === "confirm") {
    const created = await createAgent({
      actor: context.actor,
      requestId: `telegram:${context.update.updateId}`,
      data: {
        name: state.name,
        description: state.description || undefined,
        instructions: state.instructions,
        providerCredentialId: state.providerCredentialId,
        model: state.model,
        temperature: 0.2,
        maxOutputTokens: 2048,
        publish: state.publish === true,
      },
    });
    context.session = await completeTelegramFlow(context.session, {
      selectedAgentId: created.status === "published" && created.ready ? created.id : context.session.selectedAgentId,
      selectedConversationId: null,
    });
    return sendTelegramMenu({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      path: "الرئيسية ← الوكلاء ← نتيجة الإنشاء",
      title: `تم إنشاء الوكيل: ${created.name}`,
      description: `الحالة: ${created.status === "published" ? "منشور" : "مسودة"}\nالمزود: ${created.providerName ?? "غير متاح"}\nالنموذج: ${created.model}\nتمت إعادة قراءة الوكيل من قاعدة البيانات بنجاح.`,
      buttonRows: [
        ...(created.status === "published" && created.ready ? [[{ id: "chat:new", title: "تشغيله في محادثة" }]] : []),
        [{ id: `agt:v:${created.id}`, title: "تفاصيل الوكيل" }, { id: "nav:home", title: "الرئيسية" }],
      ],
    });
  }
  throw new ApiError(409, "TELEGRAM_FLOW_STEP_INVALID", "هذا الاختيار لا يطابق الخطوة الحالية.");
}
