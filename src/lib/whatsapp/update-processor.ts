import { eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappWebhookEvents } from "@/db/schema";
import {
  channelPolicyForWhatsApp,
  connectionForWhatsAppPolicy,
  ensureOrganizationWhatsAppProjection,
  resolveEffectiveWhatsAppPolicy,
  withWhatsAppChannelPolicy,
} from "@/lib/channels/whatsapp-platform";
import { whatsappChannelAdapter } from "@/lib/channels/whatsapp-adapter";
import { deniedChannelFeature, requiredChannelFeatures } from "@/lib/channel-client/feature-guard";
import { processChannelIntegrations } from "@/lib/channel-client/integration-runtime";
import { processChannelOperations } from "@/lib/channel-client/operations-runtime";
import { processChannelClientInput } from "@/lib/channel-client/runtime";
import { ensureChannelClientSession, finishChannelFlow } from "@/lib/channel-client/session-service";
import { presentChannelClientError } from "@/lib/channel-client/error-presenter";
import { sendChannelClientView } from "@/lib/channel-client/message-renderer";
import { isFeatureEnabled } from "@/lib/control-plane/features";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { markMessageAsRead } from "@/lib/integrations/whatsapp/client";
import {
  connectedWhatsAppUser,
  consumeWhatsAppConnectToken,
  disconnectWhatsAppByWaId,
  parseConnectToken,
  touchWhatsAppInteraction,
} from "@/lib/integrations/whatsapp/linking";
import type { WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import { createWhatsAppChannelClientTransport } from "./transport";

function messageText(message: WhatsAppIncomingMessage) {
  return message.type === "text"
    ? message.text?.body?.trim() ?? ""
    : message.image?.caption?.trim()
      ?? message.document?.caption?.trim()
      ?? message.video?.caption?.trim()
      ?? "";
}

function actionId(message: WhatsAppIncomingMessage) {
  const raw = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? null;
  const aliases: Record<string, string> = {
    "wa.menu": "cc.home",
    "wa.open_chat": "cc.chat",
    "wa.status": "cc.account",
    "wa.account": "cc.account",
  };
  return raw ? aliases[raw] ?? raw : null;
}

function runtimeActionId(message: WhatsAppIncomingMessage) {
  const interactive = actionId(message);
  if (interactive) return interactive;
  const text = messageText(message).trim().toLocaleLowerCase("en-US");
  if (["/start", "/menu", "/help", "القائمة", "الرئيسية", "مساعدة", "المساعدة"].includes(text)) return "cc.home";
  return null;
}

function unlinkAction(message: WhatsAppIncomingMessage) {
  const value = (actionId(message) || messageText(message)).trim().toLocaleLowerCase("en-US");
  if (["wa.disconnect", "cc.unlink", "/disconnect", "/unlink", "فصل الحساب", "إلغاء الربط", "الغاء الربط"].includes(value)) return "request";
  if (value === "cc.unlink.confirm") return "confirm";
  if (value === "cc.unlink.cancel") return "cancel";
  return null;
}

function syntheticPayload(message: WhatsAppIncomingMessage, phoneNumberId: string) {
  return {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [message] } }] }],
  };
}

async function markEvent(id: string, status: string, errorCode?: string) {
  await db().update(whatsappWebhookEvents).set({
    status,
    errorCode: errorCode ?? null,
    completedAt: new Date(),
  }).where(eq(whatsappWebhookEvents.id, id));
}

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown>) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

function policyFeatureResolver(policy: Awaited<ReturnType<typeof resolveEffectiveWhatsAppPolicy>>) {
  const recognizedAdministrativeActions = new Set([
    "admin.commands",
    "agents.manage",
    "runs.manage",
    "approvals.manage",
    "integrations.read",
    "site_connections.read",
    "mcp.read",
    "browser.read",
    "sandbox.read",
  ]);
  return async (key: string) => {
    if (key.startsWith("action:")) return policy.allowedActions.includes(key.slice("action:".length));
    if (key === "whatsapp.chat") {
      return policy.status === "active"
        && policy.autoReplyEnabled
        && policy.permissions.includes("ai.chat")
        && policy.permissions.includes("conversation.open");
    }
    if (key === "whatsapp.agents") return policy.permissions.includes("agent.use");
    if (["whatsapp.files", "whatsapp.images", "whatsapp.audio", "whatsapp.video"].includes(key)) {
      return policy.filesEnabled && policy.permissions.includes("files.use");
    }
    if (key === "whatsapp.admin_commands") {
      return policy.allowedActions.some((action) => recognizedAdministrativeActions.has(action));
    }
    return false;
  };
}

async function executeRuntime(input: Parameters<typeof processChannelClientInput>[0]) {
  return await processChannelIntegrations(input)
    ?? await processChannelOperations(input)
    ?? processChannelClientInput(input);
}

export async function processWhatsAppChannelUpdate(input: {
  eventRowId: string;
  message: WhatsAppIncomingMessage;
}) {
  const config = requireWhatsAppConfig();
  const transport = createWhatsAppChannelClientTransport({ to: input.message.from, publicAppUrl: config.publicAppUrl });
  await markMessageAsRead({ messageId: input.message.id }).catch(() => undefined);

  try {
    const token = parseConnectToken(messageText(input.message));
    if (token) {
      const linked = await consumeWhatsAppConnectToken({ token, waId: input.message.from, messageId: input.message.id });
      if (!linked.ok || !linked.organizationId) {
        await sendChannelClientView(transport, {
          text: linked.ok
            ? "تم التعرف على الحساب، لكن لا توجد مؤسسة محددة في رابط الربط. أنشئ رابطًا جديدًا من المؤسسة المطلوبة."
            : "رابط الربط غير صالح أو انتهت صلاحيته. أنشئ رابطًا جديدًا من إعدادات حسابك.",
          actions: [[{ title: "فتح إعدادات الربط", url: "/dashboard/settings", id: "link" }]],
        });
        await markEvent(input.eventRowId, "ignored", "WHATSAPP_LINK_INVALID");
        return;
      }
      const session = await ensureChannelClientSession({
        channel: "whatsapp", userId: linked.userId, organizationId: linked.organizationId,
        externalUserId: input.message.from, externalChatId: input.message.from,
      });
      const policy = await resolveEffectiveWhatsAppPolicy({ organizationId: linked.organizationId, userId: linked.userId });
      const projection = await ensureOrganizationWhatsAppProjection(linked.organizationId);
      const connection = connectionForWhatsAppPolicy(projection, policy);
      const incoming = whatsappChannelAdapter.normalizeIncoming(syntheticPayload(input.message, config.phoneNumberId), {
        externalAccountId: config.phoneNumberId,
      })[0];
      if (!incoming) throw new Error("WHATSAPP_MESSAGE_NORMALIZATION_FAILED");
      const featureAllowed = policyFeatureResolver(policy);
      await sendChannelClientView(transport, { text: "تم ربط حسابك بنجاح ✅" });
      await withWhatsAppChannelPolicy({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        routingPolicy: channelPolicyForWhatsApp(connection.id, policy),
      }, async () => executeRuntime({
        identity: {
          channel: "whatsapp" as const, userId: linked.userId, organizationId: linked.organizationId!,
          externalUserId: input.message.from, externalChatId: input.message.from,
        },
        session,
        connection,
        incoming: { ...incoming, eventId: `${incoming.eventId}:linked`, text: "/start" },
        text: "/start",
        actionId: "cc.home",
        transport,
        featureAllowed,
      }));
      await markEvent(input.eventRowId, "completed");
      return;
    }

    const user = await connectedWhatsAppUser(input.message.from);
    if (!user?.organizationId) {
      await sendChannelClientView(transport, {
        text: "رقم WhatsApp غير مرتبط بمؤسسة نشطة. أنشئ رابط ربط جديدًا من إعدادات حسابك في المنصة.",
        actions: [[{ title: "فتح إعدادات الربط", url: "/dashboard/settings", id: "link" }]],
      });
      await markEvent(input.eventRowId, "ignored", "WHATSAPP_ACCOUNT_NOT_LINKED");
      return;
    }
    await touchWhatsAppInteraction(user.connectionId);

    const policy = await resolveEffectiveWhatsAppPolicy({ organizationId: user.organizationId, userId: user.userId });
    if (policy.status !== "active" || !policy.autoReplyEnabled) {
      await sendChannelClientView(transport, { text: "خدمة WhatsApp الآلية معطلة لحسابك أو مؤسستك حاليًا." });
      await markEvent(input.eventRowId, "ignored", "WHATSAPP_POLICY_DISABLED");
      return;
    }
    if (!await isFeatureEnabled(user.organizationId, "whatsapp_integration", input.message.from)) {
      await sendChannelClientView(transport, { text: "وحدة WhatsApp غير مفعلة لهذه المؤسسة." });
      await markEvent(input.eventRowId, "ignored", "WHATSAPP_MODULE_DISABLED");
      return;
    }

    let session = await ensureChannelClientSession({
      channel: "whatsapp", userId: user.userId, organizationId: user.organizationId,
      externalUserId: input.message.from, externalChatId: input.message.from,
    });
    const projection = await ensureOrganizationWhatsAppProjection(user.organizationId);
    const connection = connectionForWhatsAppPolicy(projection, policy);
    const incoming = whatsappChannelAdapter.normalizeIncoming(syntheticPayload(input.message, config.phoneNumberId), {
      externalAccountId: config.phoneNumberId,
    })[0];
    if (!incoming) throw new Error("WHATSAPP_MESSAGE_NORMALIZATION_FAILED");

    const unlink = unlinkAction(input.message);
    if (unlink === "request") {
      await sendChannelClientView(transport, {
        path: ["الرئيسية", "فصل الحساب"],
        text: "سيؤدي الفصل إلى إيقاف وصول WhatsApp إلى حساب المنصة. هل تريد المتابعة؟",
        actions: [[{ id: "cc.unlink.confirm", title: "تأكيد الفصل" }, { id: "cc.unlink.cancel", title: "إلغاء" }]],
      });
      await markEvent(input.eventRowId, "completed");
      return;
    }
    if (unlink === "cancel") {
      await sendChannelClientView(transport, { text: "تم إلغاء فصل الحساب.", actions: [[{ id: "cc.home", title: "الرئيسية" }]] });
      await markEvent(input.eventRowId, "completed");
      return;
    }
    if (unlink === "confirm") {
      await disconnectWhatsAppByWaId({ waId: input.message.from, messageId: input.message.id });
      session = await finishChannelFlow(session, { selectedAgentId: null, selectedConversationId: null });
      await sendChannelClientView(transport, { text: "تم فصل WhatsApp عن حساب المنصة." });
      await markEvent(input.eventRowId, "completed");
      return;
    }

    const featureAllowed = policyFeatureResolver(policy);
    const currentActionId = runtimeActionId(input.message);
    const denied = await deniedChannelFeature({
      requirements: requiredChannelFeatures({
        channel: "whatsapp", session, incoming, actionId: currentActionId, text: incoming.text,
      }),
      featureAllowed,
    });
    if (denied) {
      await sendChannelClientView(transport, {
        text: `الميزة المطلوبة غير مفعلة لحسابك: ${denied.labelAr}. راجع مسؤول المؤسسة لتفعيلها.`,
        actions: [[{ id: "cc.home", title: "الرئيسية" }]],
      });
      await markEvent(input.eventRowId, "ignored", "WHATSAPP_FEATURE_DENIED");
      return;
    }

    const result = await withWhatsAppChannelPolicy({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      routingPolicy: channelPolicyForWhatsApp(connection.id, policy),
    }, async () => executeRuntime({
      identity: {
        channel: "whatsapp" as const, userId: user.userId, organizationId: user.organizationId!,
        externalUserId: input.message.from, externalChatId: input.message.from, displayName: user.name,
      },
      session,
      connection,
      incoming,
      text: incoming.text,
      actionId: currentActionId,
      transport,
      featureAllowed,
    }));
    safeLog("info", "whatsapp.command.handled", {
      eventRowId: input.eventRowId, handled: result.handled,
      conversationId: result.conversationId ?? null, runId: result.runId ?? null,
    });
    await markEvent(input.eventRowId, "completed");
  } catch (error) {
    const presented = presentChannelClientError(error);
    safeLog("error", "whatsapp.channel_update.failed", {
      eventRowId: input.eventRowId,
      errorCode: presented.code,
      referenceId: presented.referenceId,
    });
    await sendChannelClientView(transport, { text: presented.message }).catch(() => undefined);
    await markEvent(input.eventRowId, "failed", presented.code);
  }
}
