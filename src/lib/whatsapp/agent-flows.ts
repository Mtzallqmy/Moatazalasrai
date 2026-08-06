import { createAgent, getAccessibleAgent, listAccessibleAgents, listVerifiedProviderModels } from "@/lib/application/agents";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { ApiError } from "@/lib/http/api";
import {
  advanceWhatsAppFlow,
  finishWhatsAppFlow,
  sessionState,
  startWhatsAppFlow,
  updateWhatsAppSession,
} from "./session-service";
import {
  sendWhatsAppButtons,
  sendWhatsAppEmptyState,
  sendWhatsAppList,
  sendWhatsAppText,
} from "./message-renderer";
import type { WhatsAppRuntimeContext } from "./types";

const PAGE_SIZE = 8;
const SKIP_VALUES = new Set(["-", "تخطي", "تخطى", "skip"]);

type ProviderOption = Awaited<ReturnType<typeof listVerifiedProviderModels>>[number];

type AgentDraftState = {
  name?: string;
  description?: string;
  instructions?: string;
  providerCredentialId?: string;
  providerName?: string;
  model?: string;
  providerModels?: string[];
  publish?: boolean;
  page?: number;
};

function draftState(context: WhatsAppRuntimeContext): AgentDraftState {
  return sessionState(context.session) as AgentDraftState;
}

function textBody(context: WhatsAppRuntimeContext) {
  return context.message.type === "text" ? context.message.text?.body?.trim() ?? "" : "";
}

function interactiveId(context: WhatsAppRuntimeContext) {
  return context.message.interactive?.button_reply?.id
    ?? context.message.interactive?.list_reply?.id
    ?? "";
}

function pageActions<T>(input: {
  rows: T[];
  page: number;
  id: (row: T, index: number) => string;
  title: (row: T) => string;
  description?: (row: T) => string | undefined;
  pagePrefix: string;
}) {
  const start = input.page * PAGE_SIZE;
  const pageRows = input.rows.slice(start, start + PAGE_SIZE);
  const actions = pageRows.map((row, index) => ({
    id: input.id(row, start + index),
    title: input.title(row),
    description: input.description?.(row),
  }));
  if (input.page > 0) actions.push({ id: `${input.pagePrefix}:${input.page - 1}`, title: "السابق", description: "الصفحة السابقة" });
  if (start + PAGE_SIZE < input.rows.length) actions.push({ id: `${input.pagePrefix}:${input.page + 1}`, title: "التالي", description: "الصفحة التالية" });
  return actions;
}

export async function listWhatsAppAgents(context: WhatsAppRuntimeContext, page = 0) {
  const rows = await listAccessibleAgents({
    organizationId: context.identity.organizationId,
    role: context.identity.role,
    publishedOnly: false,
    limit: 100,
  });
  if (!rows.length) {
    const canManage = context.identity.permissions.has("agents:manage");
    await sendWhatsAppEmptyState({
      to: context.message.from,
      reason: "لا يوجد أي وكيل في المؤسسة حاليًا.",
      action: canManage ? { id: "wa.agents.create", title: "إنشاء وكيل" } : undefined,
    });
    return;
  }
  const actions = pageActions({
    rows,
    page,
    id: (agent) => `wa.agent.view:${agent.id}`,
    title: (agent) => agent.name,
    description: (agent) => `${agent.status} — ${agent.providerName} — ${agent.model}`,
    pagePrefix: "wa.agents.page",
  });
  await sendWhatsAppList({
    to: context.message.from,
    text: `الوكلاء الفعليون في المؤسسة (${rows.length}). اختر وكيلًا لعرض التفاصيل.`,
    title: "الوكلاء",
    buttonText: "عرض الوكلاء",
    actions,
  });
}

export async function showWhatsAppAgent(context: WhatsAppRuntimeContext, agentId: string) {
  const agent = await getAccessibleAgent({
    organizationId: context.identity.organizationId,
    role: context.identity.role,
    agentId,
  });
  const actions = agent.status === "published"
    ? [
        { id: `wa.chat.agent:${agent.id}`, title: "اختيار للدردشة" },
        { id: "wa.agents", title: "رجوع للوكلاء" },
      ]
    : [{ id: "wa.agents", title: "رجوع للوكلاء" }];
  await sendWhatsAppButtons({
    to: context.message.from,
    text: [
      `الوكيل: ${agent.name}`,
      `الحالة: ${agent.status}`,
      `المزود: ${agent.providerName}`,
      `النموذج: ${agent.model}`,
      `آخر تحديث: ${agent.updatedAt.toLocaleString("ar-SA")}`,
      agent.description?.trim() ? `الوصف: ${agent.description.trim()}` : "الوصف: غير محدد",
      agent.status !== "published" ? "لا يمكن تشغيل هذا الوكيل قبل نشره." : "الوكيل جاهز للاستخدام.",
    ].join("\n"),
    actions,
  });
}

export async function startWhatsAppAgentCreation(context: WhatsAppRuntimeContext) {
  const providers = await listVerifiedProviderModels(context.identity.organizationId);
  if (!providers.length) {
    const url = `${requireWhatsAppConfig().publicAppUrl}/dashboard/providers`;
    await sendWhatsAppText({
      to: context.message.from,
      text: `لا يمكن إنشاء وكيل صالح قبل إضافة مزود متحقق ونموذج متاح. افتح صفحة المزودين:\n${url}`,
      previewUrl: true,
    });
    return;
  }
  await startWhatsAppFlow({
    session: context.session,
    flow: "agent.create",
    step: "name",
    state: {},
  });
  await sendWhatsAppText({
    to: context.message.from,
    text: "إنشاء وكيل جديد — الخطوة 1/7\nأرسل اسم الوكيل. لن تُفسر رسالتك كأمر أثناء هذه العملية. اكتب «إلغاء» فقط للإلغاء.",
  });
}

async function showProviderSelection(context: WhatsAppRuntimeContext, page: number) {
  const providers = await listVerifiedProviderModels(context.identity.organizationId);
  if (!providers.length) throw new ApiError(422, "PROVIDER_UNAVAILABLE", "لا يوجد مزود متحقق ومفعل.");
  const actions = pageActions<ProviderOption>({
    rows: providers,
    page,
    id: (provider) => `wa.agent.provider:${provider.id}`,
    title: (provider) => provider.name,
    description: (provider) => `${provider.provider} — ${provider.models.length} نموذج`,
    pagePrefix: "wa.agent.providers.page",
  });
  await sendWhatsAppList({
    to: context.message.from,
    text: "إنشاء وكيل جديد — الخطوة 4/7\nاختر مزودًا متحققًا من قاعدة بيانات المؤسسة.",
    title: "المزودون",
    buttonText: "اختيار المزود",
    actions,
  });
}

async function showModelSelection(context: WhatsAppRuntimeContext, page: number) {
  const state = draftState(context);
  const models = state.providerModels ?? [];
  if (!state.providerCredentialId || !models.length) {
    throw new ApiError(422, "MODEL_UNAVAILABLE", "لم تُحمّل نماذج المزود المختار.");
  }
  const actions = pageActions({
    rows: models,
    page,
    id: (_model, index) => `wa.agent.model:${index}`,
    title: (model) => model,
    description: () => state.providerName ? `من ${state.providerName}` : undefined,
    pagePrefix: "wa.agent.models.page",
  });
  await sendWhatsAppList({
    to: context.message.from,
    text: "إنشاء وكيل جديد — الخطوة 5/7\nاختر نموذجًا متاحًا فعليًا لدى المزود.",
    title: "النماذج",
    buttonText: "اختيار النموذج",
    actions,
  });
}

async function showAgentSummary(context: WhatsAppRuntimeContext) {
  const state = draftState(context);
  if (!state.name || !state.instructions || !state.providerCredentialId || !state.providerName || !state.model || state.publish === undefined) {
    throw new ApiError(409, "WHATSAPP_SESSION_EXPIRED", "بيانات إنشاء الوكيل غير مكتملة.");
  }
  await sendWhatsAppButtons({
    to: context.message.from,
    text: [
      "تأكيد إنشاء الوكيل",
      `الاسم: ${state.name}`,
      `الوصف: ${state.description || "بدون وصف"}`,
      `المزود: ${state.providerName}`,
      `النموذج: ${state.model}`,
      `الحالة: ${state.publish ? "منشور" : "مسودة"}`,
      `التعليمات: ${state.instructions.slice(0, 350)}${state.instructions.length > 350 ? "…" : ""}`,
      "لن يُحفظ أي شيء قبل الضغط على تأكيد.",
    ].join("\n"),
    actions: [
      { id: "wa.agent.confirm", title: "تأكيد الإنشاء" },
      { id: "wa.cancel", title: "إلغاء" },
    ],
  });
}

export async function handleWhatsAppAgentCreationInput(context: WhatsAppRuntimeContext) {
  if (context.session.activeFlow !== "agent.create") return false;
  const text = textBody(context);
  const action = interactiveId(context);
  const state = draftState(context);

  if (context.session.currentStep === "name") {
    if (!text || text.length < 2 || text.length > 100) {
      await sendWhatsAppText({ to: context.message.from, text: "اسم الوكيل يجب أن يكون بين حرفين و100 حرف." });
      return true;
    }
    const next = await advanceWhatsAppFlow({ session: context.session, step: "description", patch: { name: text } });
    context.session = next;
    await sendWhatsAppText({
      to: context.message.from,
      text: "إنشاء وكيل جديد — الخطوة 2/7\nأرسل وصفًا أو هدفًا واضحًا، أو اكتب «تخطي».",
    });
    return true;
  }

  if (context.session.currentStep === "description") {
    if (!text) {
      await sendWhatsAppText({ to: context.message.from, text: "أرسل وصفًا أو اكتب «تخطي»." });
      return true;
    }
    if (!SKIP_VALUES.has(text.toLocaleLowerCase("ar")) && text.length > 1000) {
      await sendWhatsAppText({ to: context.message.from, text: "الوصف يتجاوز 1000 حرف." });
      return true;
    }
    const next = await advanceWhatsAppFlow({
      session: context.session,
      step: "instructions",
      patch: { description: SKIP_VALUES.has(text.toLocaleLowerCase("ar")) ? "" : text },
    });
    context.session = next;
    await sendWhatsAppText({
      to: context.message.from,
      text: "إنشاء وكيل جديد — الخطوة 3/7\nأرسل التعليمات الأساسية التي سيتبعها الوكيل.",
    });
    return true;
  }

  if (context.session.currentStep === "instructions") {
    if (!text || text.length > 30_000) {
      await sendWhatsAppText({ to: context.message.from, text: "التعليمات مطلوبة ويجب ألا تتجاوز 30 ألف حرف." });
      return true;
    }
    const next = await advanceWhatsAppFlow({ session: context.session, step: "provider", patch: { instructions: text } });
    context.session = next;
    await showProviderSelection(context, 0);
    return true;
  }

  if (context.session.currentStep === "provider") {
    const pageMatch = /^wa\.agent\.providers\.page:(\d+)$/.exec(action);
    if (pageMatch) {
      await showProviderSelection(context, Number(pageMatch[1]));
      return true;
    }
    const providerMatch = /^wa\.agent\.provider:([0-9a-f-]{36})$/i.exec(action);
    if (!providerMatch) {
      await showProviderSelection(context, Number(state.page ?? 0));
      return true;
    }
    const providers = await listVerifiedProviderModels(context.identity.organizationId);
    const provider = providers.find((item) => item.id === providerMatch[1]);
    if (!provider) throw new ApiError(422, "PROVIDER_UNAVAILABLE", "المزود المختار لم يعد متاحًا.");
    const next = await advanceWhatsAppFlow({
      session: context.session,
      step: "model",
      patch: {
        providerCredentialId: provider.id,
        providerName: provider.name,
        providerModels: provider.models,
      },
    });
    context.session = next;
    await showModelSelection(context, 0);
    return true;
  }

  if (context.session.currentStep === "model") {
    const pageMatch = /^wa\.agent\.models\.page:(\d+)$/.exec(action);
    if (pageMatch) {
      await showModelSelection(context, Number(pageMatch[1]));
      return true;
    }
    const modelMatch = /^wa\.agent\.model:(\d+)$/.exec(action);
    const models = state.providerModels ?? [];
    const model = modelMatch ? models[Number(modelMatch[1])] : undefined;
    if (!model) {
      await showModelSelection(context, 0);
      return true;
    }
    const next = await advanceWhatsAppFlow({ session: context.session, step: "publish", patch: { model } });
    context.session = next;
    await sendWhatsAppButtons({
      to: context.message.from,
      text: "إنشاء وكيل جديد — الخطوة 6/7\nاختر حالة الوكيل. النشر مسموح لأن المزود والنموذج تحققا الآن.",
      actions: [
        { id: "wa.agent.publish:draft", title: "حفظ كمسودة" },
        { id: "wa.agent.publish:published", title: "نشر الوكيل" },
        { id: "wa.cancel", title: "إلغاء" },
      ],
    });
    return true;
  }

  if (context.session.currentStep === "publish") {
    const publishMatch = /^wa\.agent\.publish:(draft|published)$/.exec(action);
    if (!publishMatch) {
      await sendWhatsAppText({ to: context.message.from, text: "اختر «حفظ كمسودة» أو «نشر الوكيل» من الأزرار." });
      return true;
    }
    const next = await advanceWhatsAppFlow({
      session: context.session,
      step: "confirm",
      patch: { publish: publishMatch[1] === "published" },
    });
    context.session = next;
    await showAgentSummary(context);
    return true;
  }

  if (context.session.currentStep === "confirm") {
    if (action !== "wa.agent.confirm") {
      await showAgentSummary(context);
      return true;
    }
    const current = draftState(context);
    if (!current.name || !current.instructions || !current.providerCredentialId || !current.model || current.publish === undefined) {
      throw new ApiError(409, "WHATSAPP_SESSION_EXPIRED", "بيانات إنشاء الوكيل غير مكتملة.");
    }
    const result = await createAgent({
      organizationId: context.identity.organizationId,
      actorUserId: context.identity.userId,
      requestId: context.requestId,
      values: {
        name: current.name,
        description: current.description || undefined,
        providerCredentialId: current.providerCredentialId,
        model: current.model,
        instructions: current.instructions,
        temperature: 0.2,
        maxOutputTokens: 2048,
        publish: current.publish,
      },
    });
    const next = await finishWhatsAppFlow({
      session: context.session,
      selectedAgentId: result.agent.status === "published" ? result.agent.id : context.session.selectedAgentId,
    });
    context.session = next;
    await sendWhatsAppButtons({
      to: context.message.from,
      text: [
        "تم إنشاء الوكيل فعليًا في قاعدة البيانات.",
        `الاسم: ${result.agent.name}`,
        `الحالة: ${result.agent.status}`,
        `الإصدار: ${result.version.version}`,
        `النموذج: ${result.version.model}`,
      ].join("\n"),
      actions: result.agent.status === "published"
        ? [
            { id: `wa.chat.agent:${result.agent.id}`, title: "بدء محادثة" },
            { id: `wa.agent.view:${result.agent.id}`, title: "عرض الوكيل" },
          ]
        : [{ id: `wa.agent.view:${result.agent.id}`, title: "عرض الوكيل" }],
    });
    return true;
  }

  throw new ApiError(409, "WHATSAPP_SESSION_EXPIRED", "خطوة إنشاء الوكيل غير معروفة.");
}

export async function selectWhatsAppAgent(context: WhatsAppRuntimeContext, agentId: string) {
  const agent = await getAccessibleAgent({
    organizationId: context.identity.organizationId,
    role: context.identity.role,
    agentId,
    requirePublished: true,
  });
  const session = await updateWhatsAppSession({
    session: context.session,
    activeFlow: null,
    currentStep: null,
    state: {},
    selectedAgentId: agent.id,
    selectedConversationId: null,
  });
  context.session = session;
  await sendWhatsAppText({
    to: context.message.from,
    text: `تم اختيار الوكيل «${agent.name}». أرسل رسالتك التالية لبدء محادثة حقيقية معه.`,
  });
}
