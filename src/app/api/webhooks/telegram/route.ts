import { after } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import { channelContacts } from "@/db/channel-schema";
import { telegramUpdates } from "@/db/schema";
import { ensureCentralTelegramChannelConnection } from "@/lib/channels/connections";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import { telegramChannelAdapter } from "@/lib/channels/telegram-adapter";
import { apiSuccess, getRequestId } from "@/lib/http/api";
import { sendTelegramMessage } from "@/lib/integrations/telegram";
import {
  centralTelegramBot,
  consumeTelegramLinkCode,
  resolveTelegramAccount,
  telegramFeatureAllowed,
  telegramPlatformConfig,
  verifyTelegramWebhookSecret,
  type TelegramFeatureKey,
} from "@/lib/integrations/telegram-platform";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

type TelegramUser = { id?: number; username?: string; first_name?: string; last_name?: string };
type TelegramMessage = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number };
  from?: TelegramUser;
  document?: { file_id?: string };
  photo?: Array<{ file_id?: string }>;
  audio?: { file_id?: string };
  voice?: { file_id?: string };
  video?: { file_id?: string };
};
type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: { id?: string; data?: string; from?: TelegramUser; message?: TelegramMessage };
};

function messageData(update: TelegramUpdate) {
  const callback = update.callback_query;
  const message = callback?.message ?? update.message;
  const user = callback?.from ?? update.message?.from;
  const chatId = message?.chat?.id;
  const telegramUserId = user?.id;
  const text = (callback?.data ?? message?.text ?? message?.caption ?? "").trim();
  if (!user || chatId === undefined || telegramUserId === undefined) return null;
  return { message, user, chatId: String(chatId), telegramUserId: String(telegramUserId), text };
}

function linkCode(text: string) {
  const start = /^\/start(?:@\w+)?\s+link_(\d{6,10})$/i.exec(text);
  if (start) return start[1];
  const plain = /^(?:ربط\s+)?(\d{6,10})$/u.exec(text);
  return plain?.[1] ?? null;
}

function requiredFeature(message: TelegramMessage, text: string): TelegramFeatureKey {
  if (text.startsWith("/admin") || text.startsWith("/github")) return "telegram.admin_commands";
  if (message.video?.file_id) return "telegram.video";
  if (message.audio?.file_id || message.voice?.file_id) return "telegram.audio";
  if (message.photo?.length) return "telegram.images";
  if (message.document?.file_id) return "telegram.files";
  return "telegram.chat";
}

async function markUpdate(id: string, status: string, errorCode?: string) {
  await db().update(telegramUpdates).set({
    status,
    errorCode: errorCode ?? null,
    completedAt: new Date(),
  }).where(eq(telegramUpdates.id, id));
}

async function processCentralUpdate(updateRowId: string, update: TelegramUpdate) {
  const data = messageData(update);
  const config = telegramPlatformConfig();
  if (!data || !config.botToken) {
    await markUpdate(updateRowId, "ignored");
    return;
  }
  try {
    const code = linkCode(data.text);
    if (code) {
      await enforceRateLimit({
        scope: "telegram.link-code.consume",
        key: data.telegramUserId,
        limit: config.linkCodeMaxAttempts,
        windowMs: config.linkCodeTtlMinutes * 60_000,
      });
      const linked = await consumeTelegramLinkCode({
        code,
        telegramUserId: data.telegramUserId,
        telegramChatId: data.chatId,
        username: data.user.username,
        firstName: data.user.first_name,
        lastName: data.user.last_name,
      });
      await sendTelegramMessage({
        token: config.botToken,
        chatId: data.chatId,
        text: linked.ok
          ? "تم ربط حساب تيليجرام بحسابك في منصة معتز بنجاح. يمكنك الآن استخدام الميزات المسموحة لك من لوحة التحكم."
          : "رمز الربط غير صالح أو انتهت صلاحيته. أنشئ رمزًا جديدًا من إعدادات حسابك.",
      });
      await markUpdate(updateRowId, linked.ok ? "completed" : "ignored");
      return;
    }

    const account = await resolveTelegramAccount(data.telegramUserId);
    if (!account) {
      await sendTelegramMessage({
        token: config.botToken,
        chatId: data.chatId,
        text: "حساب تيليجرام غير مرتبط. أنشئ رمز ربط من إعدادات حسابك في منصة معتز ثم أرسله إلى هذا البوت.",
      });
      await markUpdate(updateRowId, "ignored");
      return;
    }

    const feature = requiredFeature(data.message ?? {}, data.text);
    const permission = await telegramFeatureAllowed(account.userId, account.organizationId, feature);
    if (!permission) {
      await sendTelegramMessage({
        token: config.botToken,
        chatId: data.chatId,
        text: "هذه الميزة غير مفعلة لحسابك. راجع مسؤول المؤسسة لتفعيلها.",
      });
      await markUpdate(updateRowId, "ignored", "TELEGRAM_FEATURE_DENIED");
      return;
    }

    const bot = await centralTelegramBot();
    const connection = await ensureCentralTelegramChannelConnection({
      organizationId: account.organizationId,
      botId: String(bot.id),
      botUsername: bot.username,
    });
    const normalized = telegramChannelAdapter.normalizeIncoming(update, { externalAccountId: String(bot.id) });
    await Promise.all(normalized.map(async (incoming) => {
      await db().insert(channelContacts).values({
        organizationId: account.organizationId,
        kind: "telegram",
        externalId: incoming.senderExternalId,
        userId: account.userId,
        displayName: incoming.senderDisplayName,
        locale: incoming.locale,
        metadata: { conversationExternalId: incoming.conversationExternalId, centralBot: true },
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [channelContacts.organizationId, channelContacts.kind, channelContacts.externalId],
        set: {
          userId: account.userId,
          displayName: incoming.senderDisplayName,
          locale: incoming.locale,
          metadata: { conversationExternalId: incoming.conversationExternalId, centralBot: true },
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await routeIncomingChannelMessage({ connection, incoming });
    }));
    await markUpdate(updateRowId, "completed");
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Z0-9_.:-]{1,120}$/.test(error.message)
      ? error.message
      : error instanceof Error ? error.name.slice(0, 120) : "TELEGRAM_PROCESSING_FAILED";
    await markUpdate(updateRowId, "failed", errorCode);
    console.error(JSON.stringify({ level: "error", event: "telegram.central_update.failed", updateRowId, errorCode }));
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const config = telegramPlatformConfig();
  if (!config.enabled || config.updateMode !== "webhook") return new Response(null, { status: 404 });
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > config.webhookMaxBytes) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > config.webhookMaxBytes) return new Response(null, { status: 413 });
  let update: TelegramUpdate;
  try { update = JSON.parse(raw) as TelegramUpdate; } catch { return apiSuccess({ accepted: false }, requestId); }
  if (!Number.isSafeInteger(update.update_id)) return apiSuccess({ accepted: false }, requestId);

  let rowId: string | null = null;
  try {
    const inserted = await db().execute(sql`
      INSERT INTO "telegram_updates" ("integration_id", "update_id", "status")
      VALUES (NULL, ${String(update.update_id)}, 'accepted')
      RETURNING "id"
    `);
    const rows = databaseRows(inserted);
    const candidate = rows[0]?.id;
    rowId = typeof candidate === "string" ? candidate : null;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") return apiSuccess({ accepted: true, duplicate: true }, requestId);
    throw error;
  }
  if (rowId) after(() => processCentralUpdate(rowId, update));
  return apiSuccess({ accepted: true }, requestId);
}
