import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversations, organizationMembers, organizations, users } from "@/db/schema";
import {
  createAgentApplication,
  getUsableChannelAgent,
  listAccessibleChannelAgents,
  listVerifiedProviderOptions,
  type AgentReadinessCode,
  type ChannelAgentSummary,
} from "@/lib/agents/application-service";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import { channelAdapter } from "@/lib/channels/registry";
import { ApiError } from "@/lib/http/api";
import { resolveChannelCapabilities } from "./capability-registry";
import { presentChannelClientError } from "./error-presenter";
import { channelEmptyState, sendChannelClientView } from "./message-renderer";
import {
  advanceChannelFlow,
  finishChannelFlow,
  selectChannelAgent,
  startChannelFlow,
  updateChannelClientSession,
  type ChannelClientSession,
} from "./session-service";
import type { ChannelClientAction, ChannelClientRuntimeInput, ChannelClientRuntimeResult } from "./types";

const PAGE_SIZE = 6;
const SKIP_VALUES = new Set(["-", "تخطي", "تخطّي", "skip"]);
const READINESS_LABELS: Record<AgentReadinessCode, string> = {
  ready: "جاهز",
  draft: "مسودة",
  archived: "مؤرشف",
  provider_missing: "المزود غير موجود",
  provider_disabled: "المزود معطل",
  provider_unverified: "المزود غير متحقق",
  model_unavailable: "النموذج غير متاح",
};

type AgentCreateState = {
  name?: string;
  description?: string;
  instructions?: string;
  providerId?: string;
  providerName?: string;
  models?: string[];
  model?: string;
  publish?: boolean;
};

function stateOf(session: ChannelClientSession) {
  return session.state as AgentCreateState;
}

function commandAction(text: string) {
  const normalized = text.trim().toLocaleLowerCase("en-US").replace(/@\w+$/, "");
  const aliases: Record<string, string> = {
    "/start": "cc.home",
    "/menu": "cc.home",
    "/help": "cc.home",
    "القائمة": "cc.home",
    "الرئيسية": "cc.home",
    "/agents": "cc.agents:1",
    "الوكلاء": "cc.agents:1",
    "/new": "cc.chat",
    "محادثة": "cc.chat",
    "محادثة مباشرة": "cc.chat",
    "/files": "cc.files",
    "الملفات": "cc.files",
    "/status": "cc.account",
    "الحالة": "cc.account",
    "/cancel": "cc.cancel",
    "إلغاء": "cc.cancel",
    "الغاء": "cc.cancel",
  };
  return aliases[normalized] ?? null;
}

function navigation(currentPage: number, pages: number, prefix: string): ChannelClientAction[] {
  const actions: ChannelClientAction[] = [];
  if (currentPage > 1) actions.push({ id: `${prefix}:${currentPage - 1}`, title: "السابق" });
  if (currentPage < pages) actions.push({ id: `${prefix}:${currentPage + 1}`, title: "التالي" });
  actions.push({ id: "cc.home", title: "الرئيسية" });
  return actions;
}

async function mainMenu(input: ChannelClientRuntimeInput) {
  const capabilities = await resolveChannelCapabilities({
    identity: input.identity,
    featureAllowed: input.featureAllowed,
  });
  const work = capabilities.filter((item) => ["chat.start", "agents.list", "agents.create"].includes(item.id));
  const content = capabilities.filter((item) => item.id === "files.receive");
  const account = capabilities.filter((item) => item.id === "account.status");
  const sections = [
    work.length ? `العمل الذكي: ${work.map((item) => item.labelAr).join("، ")}` : null,
    content.length ? `المحتوى: ${content.map((item) => item.labelAr).join("، ")}` : null,
    account.length ? `الحساب: ${account.map((item) => item.labelAr).join("، ")}` : null,
  ].filter(Boolean);
  const actions = [...work, ...content, ...account].map((item) => ({
    id: item.actionId,
    title: `${item.icon ? `${item.icon} ` : ""}${item.labelAr}`,
  }));
  if (!actions.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد قدرات متاحة",
      reason: "لا توجد وحدة وصلاحية قناة مفعلة لهذا الحساب حاليًا.",
      path: ["الرئيسية"],
    }));
    return;
  }
  const rows: ChannelClientAction[][] = [];
  for (let index = 0; index < actions.length; index += 2) rows.push(actions.slice(index, index + 2));
  const active = input.session.selectedAgentId ? "يوجد وكيل مختار لهذه الجلسة." : "لم يتم اختيار وكيل بعد.";
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية"],
    text: `${sections.join("\n")}\n\n${active}\nلا تظهر هنا إلا القدرات الموصولة بتنفيذ خلفي ومسموحة لحسابك.`,
    actions: rows,
    editCurrent: Boolean(input.actionId),
  });
}

function agentDescription(agent: ChannelAgentSummary, index: number) {
  const provider = agent.providerName ?? "مزود غير متاح";
  return [
    `${index}. ${agent.name}`,
    `الحالة: ${agent.status} — ${READINESS_LABELS[agent.readiness]}`,
    `المزود: ${provider}`,
    `النموذج: ${agent.model}`,
    `آخر تحديث: ${agent.updatedAt.toLocaleString("ar-SA")}`,
  ].join("\n");
}

async function agentsView(input: ChannelClientRuntimeInput, page: number) {
  const all = await listAccessibleChannelAgents({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
    includeUnavailable: true,
  });
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const slice = all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  if (!slice.length) {
    const capabilities = await resolveChannelCapabilities({ identity: input.identity, featureAllowed: input.featureAllowed });
    const canCreate = capabilities.some((item) => item.id === "agents.create");
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا يوجد وكلاء",
      reason: canCreate
        ? "لا يوجد وكيل في المؤسسة. أنشئ وكيلًا فعليًا من هنا أو من لوحة التحكم."
        : "لا يوجد وكيل متاح، ولا تملك صلاحية إنشاء وكيل.",
      action: canCreate ? { id: "cc.agent.create", title: "إنشاء وكيل" } : { id: "cc.home", title: "الرئيسية" },
      path: ["الرئيسية", "الوكلاء"],
    }));
    return;
  }
  const actions = slice
    .filter((agent) => agent.readiness === "ready")
    .map((agent) => [{ id: `cc.agent:${agent.id}`, title: `اختيار ${agent.name}` }]);
  actions.push(navigation(current, pages, "cc.agents"));
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "الوكلاء"],
    text: `${slice.map((agent, index) => agentDescription(agent, (current - 1) * PAGE_SIZE + index + 1)).join("\n\n")}\n\nالصفحة ${current} من ${pages}. لا يمكن اختيار وكيل غير جاهز.`,
    actions,
    editCurrent: Boolean(input.actionId),
  });
}

async function beginConversation(input: ChannelClientRuntimeInput, agentId: string) {
  const agent = await getUsableChannelAgent({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
    agentId,
  });
  let session = input.session.selectedAgentId === agent.id
    ? input.session
    : await selectChannelAgent(input.session, agent.id);
  const connection = {
    ...input.connection,
    defaultAgentId: agent.id,
    defaultProviderCredentialId: agent.providerCredentialId,
    defaultModel: agent.model,
  };
  const result = await routeIncomingChannelMessage({
    connection,
    incoming: {
      ...input.incoming,
      eventId: `${input.incoming.eventId}:new:${agent.id}`,
      text: "/new",
      interactiveActionId: undefined,
      attachments: [],
    },
  });
  if (!result.conversationId) throw new Error("CHANNEL_CONVERSATION_CREATE_FAILED");
  session = await updateChannelClientSession(session, {
    selectedConversationId: result.conversationId,
    activeFlow: "chat",
    currentStep: "message",
    state: {},
    expiresAt: null,
  });
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "المحادثة"],
    text: `تم اختيار الوكيل «${agent.name}» وبدء محادثة حقيقية. أرسل رسالتك التالية وسيتم تشغيل ${agent.providerName ?? "المزود"} على النموذج ${agent.model}.`,
    actions: [[
      { id: "cc.agents:1", title: "اختيار وكيل آخر" },
      { id: "cc.home", title: "الرئيسية" },
    ]],
  });
  return { session, conversationId: result.conversationId };
}

async function chatEntry(input: ChannelClientRuntimeInput) {
  if (input.session.selectedAgentId) {
    try {
      const agent = await getUsableChannelAgent({
        organizationId: input.identity.organizationId,
        userId: input.identity.userId,
        agentId: input.session.selectedAgentId,
      });
      await sendChannelClientView(input.transport, {
        path: ["الرئيسية", "المحادثة"],
        text: `الوكيل المختار: ${agent.name}\nالمزود: ${agent.providerName ?? "غير محدد"}\nالنموذج: ${agent.model}\n\nاختر متابعة المحادثة أو إنشاء محادثة جديدة أو تغيير الوكيل.`,
        actions: [[
          { id: `cc.agent:${agent.id}`, title: "محادثة جديدة" },
          { id: "cc.chat.continue", title: "متابعة الحالية" },
        ], [{ id: "cc.agents:1", title: "اختيار وكيل آخر" }, { id: "cc.home", title: "الرئيسية" }]],
        editCurrent: Boolean(input.actionId),
      });
      return;
    } catch {
      // The saved selection became invalid; show the real current list.
    }
  }
  await agentsView(input, 1);
}

async function accountView(input: ChannelClientRuntimeInput) {
  const [row] = await db().select({
    userName: users.name,
    userEmail: users.email,
    organizationName: organizations.name,
    role: organizationMembers.role,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(
      eq(organizationMembers.userId, input.identity.userId),
      eq(organizationMembers.organizationId, input.identity.organizationId),
    )).limit(1);
  if (!row) throw new ApiError(403, "ORGANIZATION_MEMBERSHIP_REQUIRED", "الحساب لم يعد عضوًا في المؤسسة.");
  let selectedAgentName = "لا يوجد";
  if (input.session.selectedAgentId) {
    const [agent] = await db().select({ name: agents.name }).from(agents).where(and(
      eq(agents.id, input.session.selectedAgentId),
      eq(agents.organizationId, input.identity.organizationId),
    )).limit(1);
    selectedAgentName = agent?.name ?? "الاختيار السابق غير متاح";
  }
  let conversationState = "لا توجد محادثة نشطة";
  if (input.session.selectedConversationId) {
    const [conversation] = await db().select({ status: conversations.status, updatedAt: conversations.updatedAt })
      .from(conversations).where(and(
        eq(conversations.id, input.session.selectedConversationId),
        eq(conversations.organizationId, input.identity.organizationId),
      )).limit(1);
    if (conversation) conversationState = `${conversation.status} — آخر تحديث ${conversation.updatedAt.toLocaleString("ar-SA")}`;
  }
  const capabilities = await resolveChannelCapabilities({ identity: input.identity, featureAllowed: input.featureAllowed });
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "الحساب"],
    text: [
      `الاسم: ${row.userName?.trim() || "غير محدد"}`,
      `البريد: ${row.userEmail}`,
      `المؤسسة: ${row.organizationName}`,
      `الدور: ${row.role}`,
      `القناة: ${input.identity.channel === "telegram" ? "Telegram" : "WhatsApp"}`,
      `الوكيل المختار: ${selectedAgentName}`,
      `المحادثة: ${conversationState}`,
      `القدرات المتاحة: ${capabilities.map((item) => item.labelAr).join("، ") || "لا توجد"}`,
    ].join("\n"),
    actions: [[{ id: "cc.home", title: "الرئيسية" }]],
    editCurrent: Boolean(input.actionId),
  });
}

async function filesView(input: ChannelClientRuntimeInput) {
  const adapter = channelAdapter(input.identity.channel);
  const media = [
    adapter.capabilities.has("files") ? "الملفات" : null,
    adapter.capabilities.has("images") ? "الصور" : null,
    adapter.capabilities.has("audio") ? "الصوت" : null,
    adapter.capabilities.has("video") ? "الفيديو" : null,
  ].filter(Boolean);
  if (!input.session.selectedAgentId) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "اختر وكيلًا أولًا",
      reason: "لا يمكن ربط ملف بمحادثة قبل اختيار وكيل صالح.",
      action: { id: "cc.agents:1", title: "اختيار وكيل" },
      path: ["الرئيسية", "الملفات"],
    }));
    return;
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "الملفات"],
    text: `الأنواع المدعومة فعليًا في هذه القناة: ${media.join("، ") || "لا توجد وسائط"}.\nأرسل الوسائط الآن داخل المحادثة النشطة. لن تظهر رسالة نجاح قبل تنزيل الملف وتخزينه وربطه بالمحادثة.`,
    actions: [[{ id: "cc.chat.continue", title: "العودة للمحادثة" }, { id: "cc.home", title: "الرئيسية" }]],
  });
}

async function beginAgentCreate(input: ChannelClientRuntimeInput) {
  const providers = await listVerifiedProviderOptions({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
  });
  if (!providers.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا يوجد مزود جاهز",
      reason: "إنشاء وكيل صالح يحتاج مزودًا متحققًا ونموذجًا متاحًا. أضف المزود أو أصلحه من لوحة التحكم.",
      action: { title: "فتح المزودين", url: "/dashboard/providers", id: "providers" },
      path: ["الرئيسية", "إنشاء وكيل"],
    }));
    return input.session;
  }
  const session = await startChannelFlow(input.session, "agent.create", "name", {});
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "إنشاء وكيل", "الاسم"],
    text: "أرسل اسم الوكيل. يجب أن يكون بين حرفين و100 حرف. لن تُفسر الرسالة التالية كأمر.",
    actions: [[{ id: "cc.cancel", title: "إلغاء" }]],
  });
  return session;
}

async function providerSelection(input: ChannelClientRuntimeInput, session: ChannelClientSession, page = 1) {
  const providers = await listVerifiedProviderOptions({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
  });
  const pages = Math.max(1, Math.ceil(providers.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const slice = providers.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  if (!slice.length) throw new ApiError(422, "PROVIDER_UNAVAILABLE", "لا يوجد مزود متحقق ونموذج متاح.");
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "إنشاء وكيل", "المزود"],
    text: `اختر مزودًا متحققًا. الصفحة ${current} من ${pages}.`,
    actions: [
      ...slice.map((provider) => [{ id: `cc.p:${provider.id}`, title: provider.name }]),
      navigation(current, pages, "cc.providers"),
      [{ id: "cc.cancel", title: "إلغاء" }],
    ],
    editCurrent: Boolean(input.actionId),
  });
  return session;
}

async function modelSelection(input: ChannelClientRuntimeInput, session: ChannelClientSession, page = 1) {
  const state = stateOf(session);
  const models = state.models ?? [];
  const pages = Math.max(1, Math.ceil(models.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const slice = models.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  if (!slice.length) throw new ApiError(422, "MODEL_UNAVAILABLE", "لم يعد المزود يعيد نماذج صالحة.");
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "إنشاء وكيل", "النموذج"],
    text: `المزود: ${state.providerName ?? "غير محدد"}\nاختر النموذج الحقيقي. الصفحة ${current} من ${pages}.`,
    actions: [
      ...slice.map((model, index) => [{ id: `cc.m:${(current - 1) * PAGE_SIZE + index}`, title: model.slice(0, 60) }]),
      navigation(current, pages, "cc.models"),
      [{ id: "cc.cancel", title: "إلغاء" }],
    ],
    editCurrent: Boolean(input.actionId),
  });
  return session;
}

async function renderAgentConfirmation(input: ChannelClientRuntimeInput, session: ChannelClientSession) {
  const state = stateOf(session);
  const required = [state.name, state.instructions, state.providerId, state.model];
  if (required.some((value) => !value)) throw new Error("AGENT_FLOW_STATE_INCOMPLETE");
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "إنشاء وكيل", "التأكيد"],
    text: [
      `الاسم: ${state.name}`,
      `الوصف: ${state.description || "بدون وصف"}`,
      `المزود: ${state.providerName}`,
      `النموذج: ${state.model}`,
      `الحالة: ${state.publish ? "نشر" : "مسودة"}`,
      `التعليمات: ${state.instructions?.slice(0, 800)}`,
      "",
      "لن يُحفظ الوكيل قبل التأكيد.",
    ].join("\n"),
    actions: [[
      { id: "cc.agent.confirm", title: "تأكيد الإنشاء" },
      { id: "cc.cancel", title: "إلغاء" },
    ]],
    editCurrent: Boolean(input.actionId),
  });
}

async function handleAgentCreateFlow(input: ChannelClientRuntimeInput, action: string | null) {
  let session = input.session;
  const state = stateOf(session);
  if (action === "cc.cancel") {
    session = await finishChannelFlow(session);
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية"],
      text: "تم إلغاء إنشاء الوكيل. لم يتم حفظ أي وكيل.",
      actions: [[{ id: "cc.home", title: "الرئيسية" }]],
    });
    return session;
  }
  if (session.currentStep === "name") {
    const value = input.text.trim();
    if (value.length < 2 || value.length > 100) throw new ApiError(422, "AGENT_NAME_INVALID", "أرسل اسمًا بين حرفين و100 حرف.");
    session = await advanceChannelFlow(session, "description", { ...state, name: value });
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "إنشاء وكيل", "الوصف"],
      text: "أرسل وصفًا أو هدفًا مختصرًا للوكيل، أو أرسل «تخطي».",
      actions: [[{ id: "cc.cancel", title: "إلغاء" }]],
    });
    return session;
  }
  if (session.currentStep === "description") {
    const value = input.text.trim();
    session = await advanceChannelFlow(session, "instructions", {
      ...state,
      description: SKIP_VALUES.has(value.toLocaleLowerCase("ar")) ? "" : value.slice(0, 1000),
    });
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "إنشاء وكيل", "التعليمات"],
      text: "أرسل التعليمات الأساسية التي سيتبعها الوكيل. هذا الحقل مطلوب.",
      actions: [[{ id: "cc.cancel", title: "إلغاء" }]],
    });
    return session;
  }
  if (session.currentStep === "instructions") {
    const value = input.text.trim();
    if (!value) throw new ApiError(422, "AGENT_INSTRUCTIONS_REQUIRED", "تعليمات الوكيل مطلوبة.");
    session = await advanceChannelFlow(session, "provider", { ...state, instructions: value.slice(0, 30_000) });
    return providerSelection(input, session, 1);
  }
  if (session.currentStep === "provider") {
    if (action?.startsWith("cc.providers:")) return providerSelection(input, session, Number(action.split(":")[1] ?? 1));
    if (!action?.startsWith("cc.p:")) {
      await providerSelection(input, session, 1);
      return session;
    }
    const providerId = action.slice("cc.p:".length);
    const providers = await listVerifiedProviderOptions({ organizationId: input.identity.organizationId, userId: input.identity.userId });
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) throw new ApiError(422, "PROVIDER_UNAVAILABLE", "المزود لم يعد متاحًا.");
    session = await advanceChannelFlow(session, "model", {
      ...state,
      providerId: provider.id,
      providerName: provider.name,
      models: provider.models,
    });
    return modelSelection(input, session, 1);
  }
  if (session.currentStep === "model") {
    if (action?.startsWith("cc.models:")) return modelSelection(input, session, Number(action.split(":")[1] ?? 1));
    if (!action?.startsWith("cc.m:")) {
      await modelSelection(input, session, 1);
      return session;
    }
    const index = Number(action.slice("cc.m:".length));
    const model = state.models?.[index];
    if (!model) throw new ApiError(422, "MODEL_UNAVAILABLE", "النموذج لم يعد متاحًا.");
    session = await advanceChannelFlow(session, "status", { ...state, model });
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "إنشاء وكيل", "الحالة"],
      text: "اختر حالة الوكيل. النشر متاح فقط لأن المزود والنموذج اجتازا التحقق.",
      actions: [[
        { id: "cc.publish:1", title: "نشر" },
        { id: "cc.publish:0", title: "حفظ كمسودة" },
      ], [{ id: "cc.cancel", title: "إلغاء" }]],
      editCurrent: true,
    });
    return session;
  }
  if (session.currentStep === "status") {
    if (!action?.startsWith("cc.publish:")) return session;
    session = await advanceChannelFlow(session, "confirm", { ...state, publish: action.endsWith(":1") });
    await renderAgentConfirmation(input, session);
    return session;
  }
  if (session.currentStep === "confirm") {
    if (action !== "cc.agent.confirm") {
      await renderAgentConfirmation(input, session);
      return session;
    }
    const current = stateOf(session);
    const result = await createAgentApplication({
      organizationId: input.identity.organizationId,
      userId: input.identity.userId,
      requestId: input.incoming.eventId,
      data: {
        name: current.name,
        description: current.description,
        instructions: current.instructions,
        providerCredentialId: current.providerId,
        model: current.model,
        temperature: 0.2,
        maxOutputTokens: 2048,
        publish: current.publish ?? false,
      },
    });
    session = await finishChannelFlow(session, {
      selectedAgentId: result.agent.status === "published" ? result.agent.id : session.selectedAgentId,
      selectedConversationId: null,
    });
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "الوكلاء", "تم الإنشاء"],
      text: `تم إنشاء الوكيل «${result.agent.name}» فعليًا.\nالحالة: ${result.agent.status}\nالمزود: ${current.providerName}\nالنموذج: ${result.version.model}\nالإصدار: ${result.version.version}`,
      actions: result.agent.status === "published"
        ? [[{ id: `cc.agent:${result.agent.id}`, title: "بدء محادثة" }, { id: "cc.agents:1", title: "الوكلاء" }]]
        : [[{ id: "cc.agents:1", title: "الوكلاء" }, { id: "cc.home", title: "الرئيسية" }]],
    });
    return session;
  }
  return session;
}

async function routeChatMessage(input: ChannelClientRuntimeInput) {
  if (!input.session.selectedAgentId) {
    await agentsView(input, 1);
    return { session: input.session };
  }
  const agent = await getUsableChannelAgent({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
    agentId: input.session.selectedAgentId,
  });
  await input.transport.sendTyping?.();
  const result = await routeIncomingChannelMessage({
    connection: {
      ...input.connection,
      defaultAgentId: agent.id,
      defaultProviderCredentialId: agent.providerCredentialId,
      defaultModel: agent.model,
    },
    incoming: input.incoming,
  });
  if (!result.conversationId) throw new Error("CHANNEL_CONVERSATION_MISSING");
  const session = input.session.selectedConversationId === result.conversationId
    ? input.session
    : await updateChannelClientSession(input.session, {
        selectedConversationId: result.conversationId,
        activeFlow: "chat",
        currentStep: "message",
        expiresAt: null,
      });
  return { session, conversationId: result.conversationId, runId: result.runId };
}

export async function processChannelClientInput(input: ChannelClientRuntimeInput): Promise<ChannelClientRuntimeResult> {
  let session = input.session;
  const action = input.actionId || commandAction(input.text);
  try {
    if (input.actionId) await input.transport.answerCallback?.();

    if (action === "cc.cancel") {
      if (!session.activeFlow) {
        await sendChannelClientView(input.transport, {
          path: ["الرئيسية"],
          text: "لا توجد عملية نشطة لإلغائها.",
          actions: [[{ id: "cc.home", title: "الرئيسية" }]],
        });
        return { handled: true, session };
      }
      session = await finishChannelFlow(session);
      await sendChannelClientView(input.transport, {
        path: ["الرئيسية"],
        text: "تم إلغاء العملية النشطة فقط. لم تُحذف المحادثات أو الوكلاء المحفوظون.",
        actions: [[{ id: "cc.home", title: "الرئيسية" }]],
      });
      return { handled: true, session };
    }

    if (session.activeFlow === "agent.create") {
      session = await handleAgentCreateFlow(input, action);
      return { handled: true, session };
    }

    if (action === "cc.home") {
      await mainMenu(input);
      return { handled: true, session };
    }
    if (action?.startsWith("cc.agents:")) {
      await agentsView(input, Number(action.split(":")[1] ?? 1));
      return { handled: true, session };
    }
    if (action === "cc.agent.create") {
      session = await beginAgentCreate(input);
      return { handled: true, session };
    }
    if (action?.startsWith("cc.agent:")) {
      const result = await beginConversation(input, action.slice("cc.agent:".length));
      return { handled: true, ...result };
    }
    if (action === "cc.chat") {
      await chatEntry(input);
      return { handled: true, session };
    }
    if (action === "cc.chat.continue") {
      session = await updateChannelClientSession(session, {
        activeFlow: "chat",
        currentStep: "message",
        expiresAt: null,
      });
      await sendChannelClientView(input.transport, {
        path: ["الرئيسية", "المحادثة"],
        text: "أرسل رسالتك الآن إلى الوكيل المختار.",
        actions: [[{ id: "cc.agents:1", title: "تغيير الوكيل" }, { id: "cc.home", title: "الرئيسية" }]],
      });
      return { handled: true, session };
    }
    if (action === "cc.files") {
      await filesView(input);
      return { handled: true, session };
    }
    if (action === "cc.account") {
      await accountView(input);
      return { handled: true, session };
    }

    if (session.activeFlow === "chat" || input.incoming.attachments.length > 0 || input.text.trim()) {
      const routed = await routeChatMessage({ ...input, session });
      return { handled: true, ...routed };
    }
    return { handled: false, session };
  } catch (error) {
    const presented = presentChannelClientError(error);
    console.error(JSON.stringify({
      level: "error",
      event: "channel.client.failed",
      channel: input.identity.channel,
      organizationId: input.identity.organizationId,
      userId: input.identity.userId,
      errorCode: presented.code,
      referenceId: presented.referenceId,
    }));
    await sendChannelClientView(input.transport, {
      text: presented.message,
      actions: [[{ id: "cc.home", title: "الرئيسية" }]],
    });
    return { handled: true, session };
  }
}
