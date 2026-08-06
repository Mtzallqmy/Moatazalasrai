import { eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramUpdates } from "@/db/schema";
import { ensureCentralTelegramChannelConnection } from "@/lib/channels/connections";
import { telegramChannelAdapter } from "@/lib/channels/telegram-adapter";
import { deniedChannelFeature, requiredChannelFeatures } from "@/lib/channel-client/feature-guard";
import { processChannelClientInput } from "@/lib/channel-client/runtime";
import { ensureChannelClientSession, finishChannelFlow } from "@/lib/channel-client/session-service";
import { presentChannelClientError } from "@/lib/channel-client/error-presenter";
import { sendChannelClientView } from "@/lib/channel-client/message-renderer";
import {
  centralTelegramBot,
  consumeTelegramLinkCode,
  resolveTelegramAccount,
  telegramFeatureAllowed,
  telegramPlatformConfig,
  unlinkTelegramAccount,
} from "@/lib/integrations/telegram-platform";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createTelegramChannelClientTransport } from "./transport";

export type CentralTelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    chat?: { id?: number };
    from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  };
  edited_message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    chat?: { id?: number };
    from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number; username?: string; first_name?: string; last_name?: string };
    message?: { message_id?: number; chat?: { id?: number } };
  };
};

function linkCode(text: string) {
  const start = /^\/start(?:@\w+)?\s+link_(\d{6,10})$/i.exec(text.trim());
  if (start) return start[1];
  const plain = /^(?:ربط\s+)?(\d{6,10})$/u.exec(text.trim());
  return plain?.[1] ?? null;
}

function unlinkAction(text: string, actionId?: string) {
  const value = (actionId || text).trim().toLocaleLowerCase("en-US").replace(/@\w+$/, "");
  if (["/unlink", "فصل الحساب", "إلغاء الربط", "الغاء الربط", "cc.unlink"].includes(value)) return "request";
  if (value === "cc.unlink.confirm") return "confirm";
  if (value === "cc.unlink.cancel") return "cancel";
  return null;
}

function updateMessageId(update: CentralTelegramUpdate) {
  const value = update.callback_query?.message?.message_id
    ?? update.message?.message_id
    ?? update.edited_message?.message_id;
  return value === undefined ? null : String(value);
}

async function markUpdate(id: string, status: string, errorCode?: string) {
  await db().update(telegramUpdates).set({
    status,
    errorCode: errorCode ?? null,
    completedAt: new Date(),
  }).where(eq(telegramUpdates.id, id));
}

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown>) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

export async function processCentralTelegramUpdate(input: {
  updateRowId: string;
  update: CentralTelegramUpdate;
}) {
  const config = telegramPlatformConfig();
  if (!config.enabled || !config.botToken || !config.publicAppUrl) {
    await markUpdate(input.updateRowId, "failed", "TELEGRAM_DISABLED");
    return;
  }
  const bot = await centralTelegramBot();
  const incoming = telegramChannelAdapter.normalizeIncoming(input.update, { externalAccountId: String(bot.id) })[0];
  if (!incoming) {
    await markUpdate(input.updateRowId, "ignored", "TELEGRAM_UPDATE_UNSUPPORTED");
    return;
  }
  const transport = createTelegramChannelClientTransport({
    token: config.botToken,
    chatId: incoming.conversationExternalId,
    messageId: updateMessageId(input.update),
    publicAppUrl: config.publicAppUrl,
  });

  try {
    const code = linkCode(incoming.text);
    if (code) {
      safeLog("info", "telegram.link.started", { updateRowId: input.updateRowId });
      await enforceRateLimit({
        scope: "telegram.link-code.consume",
        key: incoming.senderExternalId,
        limit: config.linkCodeMaxAttempts,
        windowMs: config.linkCodeTtlMinutes * 60_000,
      });
      const source = input.update.message?.from ?? input.update.edited_message?.from ?? input.update.callback_query?.from;
      const linked = await consumeTelegramLinkCode({
        code,
        telegramUserId: incoming.senderExternalId,
        telegramChatId: incoming.conversationExternalId,
        username: source?.username,
        firstName: source?.first_name,
        lastName: source?.last_name,
      });
      if (!linked.ok) {
        await sendChannelClientView(transport, {
          text: "رمز الربط غير صالح أو انتهت صلاحيته. أنشئ رمزًا جديدًا من إعدادات حسابك.",
          actions: [[{ title: "فتح إعدادات الربط", url: "/dashboard/integrations", id: "link" }]],
        });
        safeLog("warn", "telegram.link.failed", { updateRowId: input.updateRowId, errorCode: "TELEGRAM_LINK_INVALID" });
        await markUpdate(input.updateRowId, "ignored", "TELEGRAM_LINK_INVALID");
        return;
      }
      const session = await ensureChannelClientSession({
        channel: "telegram",
        userId: linked.userId,
        organizationId: linked.organizationId,
        externalUserId: incoming.senderExternalId,
        externalChatId: incoming.conversationExternalId,
      });
      const connection = await ensureCentralTelegramChannelConnection({
        organizationId: linked.organizationId,
        botId: String(bot.id),
        botUsername: bot.username,
        actorUserId: linked.userId,
      });
      const featureAllowed = async (key: string) => Boolean(
        await telegramFeatureAllowed(linked.userId, linked.organizationId, key as never),
      );
      await sendChannelClientView(transport, { text: "تم ربط حسابك بنجاح ✅" });
      await processChannelClientInput({
        identity: {
          channel: "telegram",
          userId: linked.userId,
          organizationId: linked.organizationId,
          externalUserId: incoming.senderExternalId,
          externalChatId: incoming.conversationExternalId,
          displayName: incoming.senderDisplayName,
        },
        session,
        connection,
        incoming: { ...incoming, eventId: `${incoming.eventId}:linked`, text: "/start" },
        text: "/start",
        transport,
        featureAllowed,
      });
      safeLog("info", "telegram.link.succeeded", { updateRowId: input.updateRowId });
      await markUpdate(input.updateRowId, "completed");
      return;
    }

    const account = await resolveTelegramAccount(incoming.senderExternalId);
    if (!account) {
      await sendChannelClientView(transport, {
        text: "حساب Telegram غير مرتبط. أنشئ رمز ربط من صفحة التكاملات ثم افتح البوت من الرابط المخصص.",
        actions: [[{ title: "فتح إعدادات الربط", url: "/dashboard/integrations", id: "link" }]],
      });
      await markUpdate(input.updateRowId, "ignored", "TELEGRAM_ACCOUNT_NOT_LINKED");
      return;
    }

    let session = await ensureChannelClientSession({
      channel: "telegram",
      userId: account.userId,
      organizationId: account.organizationId,
      externalUserId: incoming.senderExternalId,
      externalChatId: incoming.conversationExternalId,
    });
    const connection = await ensureCentralTelegramChannelConnection({
      organizationId: account.organizationId,
      botId: String(bot.id),
      botUsername: bot.username,
      actorUserId: account.userId,
    });

    const unlink = unlinkAction(incoming.text, incoming.interactiveActionId);
    if (unlink === "request") {
      await sendChannelClientView(transport, {
        path: ["الرئيسية", "فصل الحساب"],
        text: "سيؤدي الفصل إلى إيقاف وصول Telegram إلى حساب المنصة. هل تريد المتابعة؟",
        actions: [[
          { id: "cc.unlink.confirm", title: "تأكيد الفصل" },
          { id: "cc.unlink.cancel", title: "إلغاء" },
        ]],
        editCurrent: Boolean(incoming.interactiveActionId),
      });
      await markUpdate(input.updateRowId, "completed");
      return;
    }
    if (unlink === "cancel") {
      await sendChannelClientView(transport, {
        text: "تم إلغاء فصل الحساب.",
        actions: [[{ id: "cc.home", title: "الرئيسية" }]],
        editCurrent: true,
      });
      await markUpdate(input.updateRowId, "completed");
      return;
    }
    if (unlink === "confirm") {
      await unlinkTelegramAccount({
        userId: account.userId,
        organizationId: account.organizationId,
        actorUserId: account.userId,
      });
      session = await finishChannelFlow(session, { selectedAgentId: null, selectedConversationId: null });
      await sendChannelClientView(transport, { text: "تم فصل حساب Telegram عن حساب المنصة." });
      await markUpdate(input.updateRowId, "completed");
      return;
    }

    const featureAllowed = async (key: string) => Boolean(
      await telegramFeatureAllowed(account.userId, account.organizationId, key as never),
    );
    const denied = await deniedChannelFeature({
      requirements: requiredChannelFeatures({
        channel: "telegram",
        session,
        incoming,
        actionId: incoming.interactiveActionId,
        text: incoming.text,
      }),
      featureAllowed,
    });
    if (denied) {
      await sendChannelClientView(transport, {
        text: `الميزة المطلوبة غير مفعلة لحسابك: ${denied.labelAr}. راجع مسؤول المؤسسة لتفعيلها.`,
        actions: [[{ id: "cc.home", title: "الرئيسية" }]],
      });
      await markUpdate(input.updateRowId, "ignored", "TELEGRAM_FEATURE_DENIED");
      return;
    }

    const result = await processChannelClientInput({
      identity: {
        channel: "telegram",
        userId: account.userId,
        organizationId: account.organizationId,
        externalUserId: incoming.senderExternalId,
        externalChatId: incoming.conversationExternalId,
        displayName: incoming.senderDisplayName,
      },
      session,
      connection,
      incoming,
      text: incoming.text,
      actionId: incoming.interactiveActionId,
      transport,
      featureAllowed,
    });
    safeLog("info", "telegram.command.handled", {
      updateRowId: input.updateRowId,
      handled: result.handled,
      conversationId: result.conversationId ?? null,
      runId: result.runId ?? null,
    });
    await markUpdate(input.updateRowId, "completed");
  } catch (error) {
    const presented = presentChannelClientError(error);
    safeLog("error", "telegram.central_update.failed", {
      updateRowId: input.updateRowId,
      errorCode: presented.code,
      referenceId: presented.referenceId,
    });
    await sendChannelClientView(transport, { text: presented.message }).catch(() => undefined);
    await markUpdate(input.updateRowId, "failed", presented.code);
  }
}