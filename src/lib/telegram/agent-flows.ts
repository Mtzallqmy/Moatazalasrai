import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, agents, providerCredentials } from "@/db/schema";
import { createAgent, listVerifiedProviderModels } from "@/lib/agents/application-service";
import { ApiError } from "@/lib/http/api";
import type { TelegramInlineButton } from "@/lib/integrations/telegram";
import { assertTelegramCapability } from "./capability-registry";
import { sendTelegramEmptyState, sendTelegramList, sendTelegramMenu, sendTelegramText } from "./message-renderer";
import {
  advanceTelegramFlow,
  beginTelegramFlow,
  cancelTelegramFlow,
  getTelegramSession,
  selectTelegramAgent,
  type TelegramSessionState,
} from "./session-service";

const PAGE_SIZE = 8;

type AgentFlowContext = {
  token: string;
  chatId: string;
  telegramUserId: string;
  userId: string;
  organizationId: string;
};

type DraftState = {
  name?: string;
  description?: string;
  instructions?: string;
  providerCredentialId?: string;
  providerName?: string;
  model?: string;
  publish?: boolean;
  providerOptions?: Array<{ id: string; name: string; models: string[] }>;
  modelOptions?: string[];
};

function draftState(value: TelegramSessionState): DraftState {
  return value as DraftState;
}

function navigationRows(extra: TelegramInlineButton[][] = []): TelegramInlineButton[][] {
  return [...extra, [{ id: "nav:home", title: "الرئيسية" }, { id: "flow:cancel", title: "إلغاء" }]];
}

export async function listTelegramAgents(input: AgentFlowContext & { page?: number; mode?: "browse" | "select" }) {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "agents.list",
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_CAPABILITY_DENIED", "ميزة الوكلاء غير متاحة لحسابك.");
  const canManage = Boolean(await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "agents.create",
  }));
  const page = Math.max(1, input.page ?? 1);
  const rows = await db().select({
    id: agents.id,
    name: agents.name,
    status: agents.status,
    updatedAt: agents.updatedAt,
    providerName: providerCredentials.name,
    model: agentVersions.model,
  }).from(agents)
    .innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.currentVersion)))
    .innerJoin(providerCredentials, eq(providerCredentials.id, agentVersions.providerCredentialId))
    .where(and(
      eq(agents.organizationId, input.organizationId),
      canManage ? undefined : eq(agents.status, "published"),
    ))
    .orderBy(desc(agents.updatedAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);
  if (!visible.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا يوجد وكيل متاح في المؤسسة الحالية.",
      action: canManage
        ? "يمكنك إنشاء وكيل جديد بعد توفر مزود ونموذج متحقق منهما."
        : "اطلب من مسؤول المؤسسة نشر وكيل ومنحك صلاحية تشغيله.",
      buttonRows: canManage
        ? navigationRows([[{ id: "agents:create", title: "إنشاء وكيل جديد" }]])
        : navigationRows(),
    });
    return;
  }
  const buttons = visible.map((agent) => [{
    id: `${input.mode === "select" ? "agent:choose" : "agent:view"}:${agent.id}`,
    title: `${agent.status === "published" ? "🟢" : agent.status === "draft" ? "🟡" : "⚪"} ${agent.name}`,
  }]);
  const pagination: TelegramInlineButton[] = [];
  if (page > 1) pagination.push({ id: `agents:page:${page - 1}:${input.mode ?? "browse"}`, title: "السابق" });
  if (hasNext) pagination.push({ id: `agents:page:${page + 1}:${input.mode ?? "browse"}`, title: "التالي" });
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: `الوكلاء — الصفحة ${page}`,
    items: visible.map((agent, index) => [
      `${index + 1}. ${agent.name}`,
      `الحالة: ${agent.status}`,
      `المزود: ${agent.providerName}`,
      `النموذج: ${agent.model}`,
      `آخر تحديث: ${new Date(agent.updatedAt).toLocaleString("ar-SA")}`,
    ].join(" — ")),
    emptyText: "لا يوجد وكلاء.",
    buttonRows: navigationRows([
      ...buttons,
      ...(pagination.length ? [pagination] : []),
      ...(canManage && input.mode !== "select" ? [[{ id: "agents:create", title: "إنشاء وكيل جديد" }]] : []),
    ]),
  });
}

export async function showTelegramAgent(input: AgentFlowContext & { agentId: string }) {
  const canManage = Boolean(await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "agents.create",
  }));
  const [agent] = await db().select({
    id: agents.id,
    name: agents.name,
    description: agents.description,
    status: agents.status,
    updatedAt: agents.updatedAt,
    providerName: providerCredentials.name,
    model: agentVersions.model,
  }).from(agents)
    .innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.currentVersion)))
    .innerJoin(providerCredentials, eq(providerCredentials.id, agentVersions.providerCredentialId))
    .where(and(eq(agents.id, input.agentId), eq(agents.organizationId, input.organizationId)))
    .limit(1);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود.");
  const rows: TelegramInlineButton[][] = [];
  if (agent.status === "published") rows.push([{ id: `agent:choose:${agent.id}`, title: "اختيار للمحادثة" }]);
  if (canManage) rows.push([{ url: `https://moatazalalqami.online/dashboard/agents?agentId=${agent.id}`, title: "فتح في لوحة الموقع" }]);
  rows.push([{ id: "agents:list", title: "رجوع إلى الوكلاء" }, { id: "nav:home", title: "الرئيسية" }]);
  await sendTelegramText({
    token: input.token,
    chatId: input.chatId,
    text: [
      `الوكيل: ${agent.name}`,
      `الحالة: ${agent.status}`,
      agent.description ? `الوصف: ${agent.description}` : null,
      `المزود: ${agent.providerName}`,
      `النموذج: ${agent.model}`,
      `آخر تحديث: ${new Date(agent.updatedAt).toLocaleString("ar-SA")}`,
    ].filter(Boolean).join("\n"),
    buttonRows: rows,
  });
}

export async function chooseTelegramAgent(input: AgentFlowContext & { agentId: string }) {
  const [agent] = await db().select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(and(
    eq(agents.id, input.agentId),
    eq(agents.organizationId, input.organizationId),
  )).limit(1);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "الوكيل غير موجود.");
  if (agent.status !== "published") throw new ApiError(422, "AGENT_DRAFT", "لا يمكن تشغيل وكيل غير منشور.");
  await selectTelegramAgent({ telegramUserId: input.telegramUserId, agentId: agent.id });
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: `تم اختيار الوكيل «${agent.name}». اختر بدء محادثة جديدة أو عد إلى الرئيسية.`,
    buttonRows: [[{ id: "chat:new", title: "بدء محادثة" }], [{ id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function startCreateAgentFlow(input: AgentFlowContext) {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "agents.create",
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_CAPABILITY_DENIED", "لا تملك صلاحية إنشاء الوكلاء.");
  await beginTelegramFlow({ telegramUserId: input.telegramUserId, flow: "agent.create", step: "name" });
  await sendTelegramText({
    token: input.token,
    chatId: input.chatId,
    text: "إنشاء وكيل جديد\n\nأرسل اسم الوكيل. لن تُلغى العملية برسالة عادية؛ استخدم /cancel فقط للإلغاء.",
    buttonRows: navigationRows(),
  });
}

export async function handleAgentCreateText(input: AgentFlowContext & { text: string }) {
  const session = await getTelegramSession(input.telegramUserId);
  if (!session || session.activeFlow !== "agent.create") return false;
  const text = input.text.trim();
  if (!text) throw new ApiError(422, "TELEGRAM_EMPTY_INPUT", "لا يمكن استخدام قيمة فارغة.");
  const state = draftState(session.state);
  if (session.currentStep === "name") {
    if (text.length < 2 || text.length > 120) throw new ApiError(422, "AGENT_NAME_INVALID", "اسم الوكيل يجب أن يكون بين حرفين و120 حرفًا.");
    await advanceTelegramFlow({ sessionId: session.id, expectedVersion: session.version, step: "description", state: { ...state, name: text } });
    await sendTelegramText({ token: input.token, chatId: input.chatId, text: "أرسل وصفًا مختصرًا أو هدف الوكيل." });
    return true;
  }
  if (session.currentStep === "description") {
    if (text.length > 500) throw new ApiError(422, "AGENT_DESCRIPTION_INVALID", "الوصف أطول من الحد المسموح.");
    await advanceTelegramFlow({ sessionId: session.id, expectedVersion: session.version, step: "instructions", state: { ...state, description: text } });
    await sendTelegramText({ token: input.token, chatId: input.chatId, text: "أرسل التعليمات الأساسية التي تحدد دور الوكيل وسلوكه." });
    return true;
  }
  if (session.currentStep === "instructions") {
    if (text.length < 10 || text.length > 12_000) throw new ApiError(422, "AGENT_INSTRUCTIONS_INVALID", "التعليمات يجب أن تكون واضحة وبين 10 و12000 حرف.");
    const providers = await listVerifiedProviderModels(input.organizationId);
    if (!providers.length) {
      await sendTelegramEmptyState({
        token: input.token,
        chatId: input.chatId,
        reason: "لا يوجد مزود متحقق منه مع نماذج متاحة، لذلك لن يُنشأ وكيل ناقص.",
        action: "أضف مزودًا واختبره من صفحة المزودات في الموقع ثم عُد لإكمال العملية.",
        buttonRows: navigationRows([[{ url: "https://moatazalalqami.online/dashboard/providers", title: "فتح صفحة المزودات" }]]),
      });
      return true;
    }
    const providerOptions = providers.map((provider) => ({ id: provider.id, name: provider.name, models: provider.models }));
    await advanceTelegramFlow({
      sessionId: session.id,
      expectedVersion: session.version,
      step: "provider",
      state: { ...state, instructions: text, providerOptions },
    });
    await sendTelegramMenu({
      token: input.token,
      chatId: input.chatId,
      title: "اختر مزودًا متحققًا منه:",
      buttonRows: navigationRows(providerOptions.map((provider, index) => [{ id: `agc:p:${index}`, title: provider.name }])),
    });
    return true;
  }
  return false;
}

export async function handleAgentCreateCallback(input: AgentFlowContext & { action: string }) {
  const session = await getTelegramSession(input.telegramUserId);
  if (!session || session.activeFlow !== "agent.create") return false;
  const state = draftState(session.state);
  if (input.action === "flow:cancel") {
    await cancelTelegramFlow(input.telegramUserId);
    await sendTelegramText({ token: input.token, chatId: input.chatId, text: "تم إلغاء إنشاء الوكيل." });
    return true;
  }
  const providerMatch = /^agc:p:(\d+)$/.exec(input.action);
  if (providerMatch && session.currentStep === "provider") {
    const provider = state.providerOptions?.[Number(providerMatch[1])];
    if (!provider) throw new ApiError(409, "TELEGRAM_FLOW_STALE", "انتهت خيارات المزود. أعد بدء العملية.");
    await advanceTelegramFlow({
      sessionId: session.id,
      expectedVersion: session.version,
      step: "model",
      state: {
        ...state,
        providerCredentialId: provider.id,
        providerName: provider.name,
        modelOptions: provider.models,
      },
    });
    await sendTelegramMenu({
      token: input.token,
      chatId: input.chatId,
      title: `اختر نموذجًا من مزود ${provider.name}:`,
      buttonRows: navigationRows(provider.models.slice(0, 24).map((model, index) => [{ id: `agc:m:${index}`, title: model.slice(0, 60) }])),
    });
    return true;
  }
  const modelMatch = /^agc:m:(\d+)$/.exec(input.action);
  if (modelMatch && session.currentStep === "model") {
    const model = state.modelOptions?.[Number(modelMatch[1])];
    if (!model) throw new ApiError(409, "TELEGRAM_FLOW_STALE", "انتهت خيارات النموذج. أعد بدء العملية.");
    await advanceTelegramFlow({ sessionId: session.id, expectedVersion: session.version, step: "status", state: { ...state, model } });
    await sendTelegramMenu({
      token: input.token,
      chatId: input.chatId,
      title: "اختر حالة الوكيل:",
      buttonRows: navigationRows([[
        { id: "agc:s:draft", title: "حفظ كمسودة" },
        { id: "agc:s:published", title: "نشر الوكيل" },
      ]]),
    });
    return true;
  }
  const statusMatch = /^agc:s:(draft|published)$/.exec(input.action);
  if (statusMatch && session.currentStep === "status") {
    const publish = statusMatch[1] === "published";
    const nextState = { ...state, publish };
    await advanceTelegramFlow({ sessionId: session.id, expectedVersion: session.version, step: "confirm", state: nextState });
    await sendTelegramMenu({
      token: input.token,
      chatId: input.chatId,
      title: [
        "تأكيد إنشاء الوكيل",
        `الاسم: ${nextState.name}`,
        `الوصف: ${nextState.description}`,
        `المزود: ${nextState.providerName}`,
        `النموذج: ${nextState.model}`,
        `الحالة: ${publish ? "منشور" : "مسودة"}`,
      ].join("\n"),
      buttonRows: navigationRows([[{ id: "agc:confirm", title: "تأكيد الإنشاء" }]]),
    });
    return true;
  }
  if (input.action === "agc:confirm" && session.currentStep === "confirm") {
    if (!state.name || !state.instructions || !state.providerCredentialId || !state.model || typeof state.publish !== "boolean") {
      throw new ApiError(409, "TELEGRAM_FLOW_INCOMPLETE", "بيانات إنشاء الوكيل غير مكتملة. أعد بدء العملية.");
    }
    const result = await createAgent({
      userId: input.userId,
      organizationId: input.organizationId,
      requestId: `telegram:${input.telegramUserId}:${session.version}`,
    }, {
      name: state.name,
      description: state.description,
      instructions: state.instructions,
      providerCredentialId: state.providerCredentialId,
      model: state.model,
      temperature: 0.4,
      maxOutputTokens: 2048,
      publish: state.publish,
    });
    await cancelTelegramFlow(input.telegramUserId);
    await sendTelegramMenu({
      token: input.token,
      chatId: input.chatId,
      title: [
        "تم إنشاء الوكيل فعليًا ✅",
        `الاسم: ${result.agent.name}`,
        `الحالة: ${result.agent.status}`,
        `النموذج: ${result.version.model}`,
      ].join("\n"),
      buttonRows: [
        ...(result.agent.status === "published" ? [[{ id: `agent:choose:${result.agent.id}`, title: "اختيار للمحادثة" }]] : []),
        [{ id: `agent:view:${result.agent.id}`, title: "عرض الوكيل" }, { id: "nav:home", title: "الرئيسية" }],
      ],
    });
    return true;
  }
  return false;
}
