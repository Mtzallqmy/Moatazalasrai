import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers } from "@/db/schema";
import { resolveEffectiveWhatsAppPolicy } from "@/lib/channels/whatsapp-platform";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { permissionsFor } from "@/lib/auth/permissions";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import {
  connectedWhatsAppUser,
  consumeWhatsAppConnectToken,
  touchWhatsAppInteraction,
} from "@/lib/integrations/whatsapp/linking";
import type { WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import { capabilityVisible, whatsappCapability } from "./capability-registry";
import {
  handleWhatsAppAgentCreationInput,
  listWhatsAppAgents,
  showWhatsAppAgent,
} from "./agent-flows";
import {
  confirmWhatsAppDisconnect,
} from "./account-flows";
import {
  activateWhatsAppChatAgent,
  chooseWhatsAppAgent,
  continueWhatsAppChat,
  listWhatsAppConversations,
  showWhatsAppConversation,
  startNewWhatsAppConversation,
} from "./conversation-flows";
import { sendWhatsAppMainMenu, sendWhatsAppSectionMenu } from "./menu-renderer";
import { answerWhatsAppMessage, sendWhatsAppError, sendWhatsAppText } from "./message-renderer";
import {
  cancelWhatsAppFlow,
  getOrCreateWhatsAppSession,
} from "./session-service";
import { parseWhatsAppUpdate } from "./update-parser";
import type { WhatsAppCapability, WhatsAppRuntimeContext } from "./types";

export type WhatsAppUpdateProcessResult = {
  handled: boolean;
  context?: WhatsAppRuntimeContext;
};

async function runtimeContext(message: WhatsAppIncomingMessage, requestId: string) {
  const connected = await connectedWhatsAppUser(message.from);
  if (!connected?.organizationId) return null;
  const [membership] = await db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, connected.organizationId),
    eq(organizationMembers.userId, connected.userId),
  )).limit(1);
  if (!membership) return null;
  const [custom, policy, session] = await Promise.all([
    loadCustomPermissions(connected.organizationId, connected.userId),
    resolveEffectiveWhatsAppPolicy({ organizationId: connected.organizationId, userId: connected.userId }),
    getOrCreateWhatsAppSession({
      userId: connected.userId,
      organizationId: connected.organizationId,
      waId: message.from,
    }),
  ]);
  return {
    message,
    identity: {
      connectionId: connected.connectionId,
      userId: connected.userId,
      organizationId: connected.organizationId,
      name: connected.name,
      email: connected.email,
      role: membership.role,
      permissions: new Set([...permissionsFor(membership.role), ...custom]),
      channelFeatures: new Set(policy.permissions),
    },
    session,
    requestId,
  } satisfies WhatsAppRuntimeContext;
}

async function unlinkedReply(message: WhatsAppIncomingMessage) {
  const config = requireWhatsAppConfig();
  await sendWhatsAppText({
    to: message.from,
    text: `هذا الرقم غير مرتبط بحساب منصة معتز. أنشئ رابط ربط آمن من صفحة الإعدادات:\n${config.publicAppUrl}/dashboard/settings`,
    previewUrl: true,
  });
}

async function processConnect(message: WhatsAppIncomingMessage, token: string, requestId: string) {
  const result = await consumeWhatsAppConnectToken({ token, waId: message.from, messageId: message.id });
  if (!result.ok) {
    await sendWhatsAppText({
      to: message.from,
      text: result.reason === "already_linked"
        ? "هذا الرقم مرتبط بحساب آخر. افصل الارتباط القديم من الحساب الصحيح أولًا."
        : "رمز الربط غير صالح أو منتهي أو مستخدم سابقًا. أنشئ رابطًا جديدًا من الموقع.",
    });
    return;
  }
  const context = await runtimeContext(message, requestId);
  await sendWhatsAppText({ to: message.from, text: "تم ربط حساب WhatsApp بحساب منصة معتز بنجاح ✅" });
  if (context) await sendWhatsAppMainMenu(context);
}

function section(value: string): WhatsAppCapability["section"] | null {
  return (["smart_work", "knowledge", "integrations", "operations", "administration"] as const)
    .find((item) => item === value) ?? null;
}

async function requireCapability(context: WhatsAppRuntimeContext, id: string) {
  const capability = whatsappCapability(id);
  if (!capability || !await capabilityVisible(context, capability)) {
    await sendWhatsAppError({
      to: context.message.from,
      text: "هذه القدرة غير متاحة وفق الوحدة أو الصلاحيات أو سياسة WhatsApp الحالية.",
    });
    return null;
  }
  return capability;
}

async function invokeCapability(context: WhatsAppRuntimeContext, id: string) {
  const capability = await requireCapability(context, id);
  if (!capability) return;
  await capability.handler(context);
}

async function runCapabilityAction(
  context: WhatsAppRuntimeContext,
  capabilityId: string,
  action: () => Promise<unknown>,
) {
  if (!await requireCapability(context, capabilityId)) return;
  await action();
}

async function handleAction(context: WhatsAppRuntimeContext, actionId: string) {
  if (actionId === "wa.menu") return sendWhatsAppMainMenu(context);
  const sectionMatch = /^wa\.section:([a-z_]+)$/.exec(actionId);
  if (sectionMatch) {
    const value = section(sectionMatch[1]);
    return value ? sendWhatsAppSectionMenu(context, value) : sendWhatsAppMainMenu(context);
  }
  const capabilityMatch = /^wa\.cap:([a-z0-9._-]+)$/.exec(actionId);
  if (capabilityMatch) return invokeCapability(context, capabilityMatch[1]);

  if (actionId === "wa.agents") return invokeCapability(context, "agents.list");
  if (actionId === "wa.agents.create") return invokeCapability(context, "agents.create");
  const agentsPage = /^wa\.agents\.page:(\d+)$/.exec(actionId);
  if (agentsPage) {
    return runCapabilityAction(context, "agents.list", () => listWhatsAppAgents(context, Number(agentsPage[1])));
  }
  const agentView = /^wa\.agent\.view:([0-9a-f-]{36})$/i.exec(actionId);
  if (agentView) {
    return runCapabilityAction(context, "agents.list", () => showWhatsAppAgent(context, agentView[1]));
  }

  if (actionId === "wa.chat") return invokeCapability(context, "chat.open");
  if (actionId === "wa.chat.choose") {
    return runCapabilityAction(context, "chat.open", () => chooseWhatsAppAgent(context, 0));
  }
  if (actionId === "wa.chat.continue") {
    return runCapabilityAction(context, "chat.open", () => continueWhatsAppChat(context));
  }
  if (actionId === "wa.chat.new") {
    return runCapabilityAction(context, "chat.open", () => startNewWhatsAppConversation(context));
  }
  const chatPage = /^wa\.chat\.page:(\d+)$/.exec(actionId);
  if (chatPage) {
    return runCapabilityAction(context, "chat.open", () => chooseWhatsAppAgent(context, Number(chatPage[1])));
  }
  const chatAgent = /^wa\.chat\.agent:([0-9a-f-]{36})$/i.exec(actionId);
  if (chatAgent) {
    return runCapabilityAction(context, "chat.open", () => activateWhatsAppChatAgent(context, chatAgent[1]));
  }

  if (actionId === "wa.conversations") return invokeCapability(context, "conversations.list");
  const conversationsPage = /^wa\.conversations\.page:(\d+)$/.exec(actionId);
  if (conversationsPage) {
    return runCapabilityAction(
      context,
      "conversations.list",
      () => listWhatsAppConversations(context, Number(conversationsPage[1])),
    );
  }
  const conversationView = /^wa\.conversation\.view:([0-9a-f-]{36})$/i.exec(actionId);
  if (conversationView) {
    return runCapabilityAction(
      context,
      "conversations.list",
      () => showWhatsAppConversation(context, conversationView[1]),
    );
  }

  if (actionId === "wa.files") return invokeCapability(context, "files.upload");
  if (actionId === "wa.account" || actionId === "wa.status") return invokeCapability(context, "account.status");
  if (actionId === "wa.disconnect") return invokeCapability(context, "account.disconnect");
  if (actionId === "wa.disconnect.confirm") {
    return runCapabilityAction(context, "account.disconnect", () => confirmWhatsAppDisconnect(context));
  }

  await sendWhatsAppError({
    to: context.message.from,
    text: "الإجراء غير معروف أو لم يعد متاحًا. افتح القائمة الرئيسية.",
  });
}

export async function processWhatsAppUpdate(input: {
  message: WhatsAppIncomingMessage;
  requestId: string;
}): Promise<WhatsAppUpdateProcessResult> {
  await answerWhatsAppMessage(input.message.id).catch(() => undefined);
  const parsed = parseWhatsAppUpdate(input.message);
  if (parsed.kind === "connect") {
    await processConnect(input.message, parsed.token, input.requestId);
    return { handled: true };
  }

  const context = await runtimeContext(input.message, input.requestId);
  if (!context) {
    await unlinkedReply(input.message);
    return { handled: true };
  }
  await touchWhatsAppInteraction(context.identity.connectionId);

  const explicitCancel = parsed.kind === "action" && parsed.actionId === "wa.cancel";
  if (explicitCancel) {
    const hadFlow = Boolean(context.session.activeFlow);
    context.session = await cancelWhatsAppFlow(context.session);
    await sendWhatsAppText({
      to: input.message.from,
      text: hadFlow ? "تم إلغاء العملية النشطة فقط." : "لا توجد عملية نشطة لإلغائها.",
    });
    await sendWhatsAppMainMenu(context);
    return { handled: true, context };
  }

  if (context.session.activeFlow === "agent.create") {
    if (await requireCapability(context, "agents.create")) {
      await handleWhatsAppAgentCreationInput(context);
    }
    return { handled: true, context };
  }
  if (context.session.activeFlow === "account.disconnect") {
    if (!await requireCapability(context, "account.disconnect")) {
      return { handled: true, context };
    }
    if (parsed.kind === "action" && parsed.actionId === "wa.disconnect.confirm") {
      await confirmWhatsAppDisconnect(context);
    } else {
      await sendWhatsAppText({
        to: input.message.from,
        text: "عملية فصل الحساب تنتظر التأكيد من الزر. اضغط «إلغاء» للرجوع دون فصل.",
      });
    }
    return { handled: true, context };
  }

  if (parsed.kind === "action") {
    await handleAction(context, parsed.actionId);
    return { handled: true, context };
  }
  if (parsed.kind === "unknown") {
    await sendWhatsAppError({
      to: input.message.from,
      text: "نوع الرسالة غير مدعوم. افتح القائمة لمعرفة الخيارات المتاحة.",
    });
    return { handled: true, context };
  }
  return { handled: false, context };
}
