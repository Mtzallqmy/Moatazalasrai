import { after } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import {
  channelAgentBindings,
  channelConnections,
  channelContacts,
} from "@/db/channel-schema";
import { agents, telegramUpdates } from "@/db/schema";
import { ensureCentralTelegramChannelConnection } from "@/lib/channels/connections";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import { telegramChannelAdapter } from "@/lib/channels/telegram-adapter";
import { ApiError, apiSuccess, getRequestId } from "@/lib/http/api";
import {
  answerTelegramCallback,
  sendTelegramMessage,
  type TelegramInlineButton,
} from "@/lib/integrations/telegram";
import {
  centralTelegramBot,
  consumeTelegramLinkCode,
  resolveTelegramAccount,
  telegramEnabledFeatures,
  telegramFeatureAllowed,
  telegramPlatformConfig,
  unlinkTelegramAccount,
  verifyTelegramWebhookSecret,
  type TelegramFeatureKey,
} from "@/lib/integrations/telegram-platform";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

type TelegramUser = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};
type TelegramMessage = {
  message_id?: number;
  date?: number;
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
type TelegramCallback = {
  id?: string;
  data?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
};
type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallback;
};
type TelegramAccount = NonNullable<Awaited<ReturnType<typeof resolveTelegramAccount>>>;
type CentralCommand = "start" | "help" | "status" | "agents" | "new" | "files" | "unlink" | "unlink_confirm" | "unlink_cancel" | "cancel";

const FEATURE_LABELS: Record<TelegramFeatureKey, string> = {
  "telegram.chat": "الدردشة",
  "telegram.agents": "الوكلاء",
  "telegram.files": "الملفات",
  "telegram.images": "الصور",
  "telegram.audio": "الصوت",
  "telegram.video": "الفيديو",
  "telegram.notifications": "الإشعارات",
  "telegram.admin_commands": "الأوامر الإدارية",
};

const MAIN_MENU: TelegramInlineButton[][] = [
  [
    { id: "telegram.new", title: "بدء محادثة" },
    { id: "telegram.agents", title: "الوكلاء" },
  ],
  [
    { id: "telegram.status", title: "حالة الحساب" },
    { id: "telegram.help", title: "المساعدة" },
  ],
];

const SAFE_FAILURE_MESSAGE = "تعذر إكمال الطلب حاليًا. حاول إنشاء رمز جديد أو راجع حالة خدمة Telegram.";
const INVALID_LINK_MESSAGE = "رمز الربط غير صالح أو انتهت صلاحيته. أنشئ رمزًا جديدًا من إعدادات حسابك.";

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

function messageData(update: TelegramUpdate) {
  const callback = update.callback_query;
  const sourceMessage = callback?.message ?? update.message ?? update.edited_message;
  const user = callback?.from ?? sourceMessage?.from;
  const chatId = sourceMessage?.chat?.id;
  const telegramUserId = user?.id;
  const text = (callback?.data ?? sourceMessage?.text ?? sourceMessage?.caption ?? "").trim();
  if (!user || !sourceMessage || chatId === undefined || telegramUserId === undefined) return null;
  return {
    message: sourceMessage,
    user,
    chatId: String(chatId),
    telegramUserId: String(telegramUserId),
    text,
    callbackId: callback?.id,
  };
}

function linkCode(text: string) {
  const start = /^\/start(?:@\w+)?\s+link_(\d{6,10})$/i.exec(text);
  if (start) return start[1];
  const plain = /^(?:ربط\s+)?(\d{6,10})$/u.exec(text);
  return plain?.[1] ?? null;
}

function centralCommand(text: string): CentralCommand | null {
  const value = text.trim().toLocaleLowerCase("en-US");
  const callback = /^telegram\.(start|help|status|agents|new|files|unlink|unlink_confirm|unlink_cancel|cancel)$/.exec(value);
  if (callback) return callback[1] as CentralCommand;
  const normalized = value.replace(/^\//, "").replace(/@\w+$/, "").trim();
  const aliases: Record<string, CentralCommand> = {
    start: "start",
    ابدأ: "start",
    help: "help",
    مساعدة: "help",
    المساعدة: "help",
    status: "status",
    الحالة: "status",
    "حالة الحساب": "status",
    agents: "agents",
    الوكلاء: "agents",
    new: "new",
    جديد: "new",
    "محادثة جديدة": "new",
    "بدء محادثة": "new",
    files: "files",
    الملفات: "files",
    unlink: "unlink",
    "فصل الحساب": "unlink",
    cancel: "cancel",
    إلغاء: "cancel",
    الغاء: "cancel",
  };
  return aliases[normalized] ?? null;
}

function requiredFeature(message: TelegramMessage, text: string): TelegramFeatureKey {
  if (text.startsWith("/admin") || text.startsWith("/github")) return "telegram.admin_commands";
  if (message.video?.file_id) return "telegram.video";
  if (message.audio?.file_id || message.voice?.file_id) return "telegram.audio";
  if (message.photo?.length) return "telegram.images";
  if (message.document?.file_id) return "telegram.files";
  return "telegram.chat";
}

function helpText() {
  return [
    "أوامر بوت معتز:",
    "/start — بدء البوت وعرض الحالة",
    "/help — عرض جميع الأوامر",
    "/status — حالة ربط الحساب والميزات المسموحة",
    "/agents — عرض الوكلاء المتاحين",
    "/new — بدء محادثة جديدة",
    "/files — تعليمات إرسال الملفات",
    "/unlink — فصل الحساب بعد التأكيد",
    "/cancel — إلغاء العملية الحالية",
  ].join("\n");
}

async function markUpdate(id: string, status: string, errorCode?: string) {
  await db().update(telegramUpdates).set({
    status,
    errorCode: errorCode ?? null,
    completedAt: new Date(),
  }).where(eq(telegramUpdates.id, id));
}

async function sendSafe(input: {
  token: string;
  chatId: string;
  text: string;
  buttonRows?: TelegramInlineButton[][];
}) {
  return sendTelegramMessage(input);
}

async function sendMenu(token: string, chatId: string, text = "اختر الإجراء المطلوب:") {
  await sendSafe({ token, chatId, text, buttonRows: MAIN_MENU });
}

async function featureAllowedOrReply(input: {
  token: string;
  chatId: string;
  account: TelegramAccount;
  feature: TelegramFeatureKey;
}) {
  const allowed = await telegramFeatureAllowed(input.account.userId, input.account.organizationId, input.feature);
  if (allowed) return true;
  await sendSafe({
    token: input.token,
    chatId: input.chatId,
    text: `الميزة المطلوبة غير مفعلة لحسابك: ${FEATURE_LABELS[input.feature]} (${input.feature}). راجع مسؤول المؤسسة لتفعيلها.`,
  });
  return false;
}

async function sendAccountStatus(token: string, chatId: string, account: TelegramAccount) {
  const features = await telegramEnabledFeatures(account.userId, account.organizationId);
  const enabled = features.length
    ? features.map((feature) => `• ${FEATURE_LABELS[feature]} — ${feature}`).join("\n")
    : "لا توجد ميزات مفعلة حاليًا.";
  await sendSafe({
    token,
    chatId,
    text: `حالة الربط: مرتبط ✅\nآخر نشاط: ${account.lastSeenAt.toISOString()}\n\nالميزات المسموحة:\n${enabled}`,
    buttonRows: MAIN_MENU,
  });
}

async function sendAgents(token: string, chatId: string, account: TelegramAccount) {
  if (!await featureAllowedOrReply({ token, chatId, account, feature: "telegram.agents" })) return;
  const rows = await db().select({ id: agents.id, name: agents.name, description: agents.description })
    .from(agents).where(and(eq(agents.organizationId, account.organizationId), eq(agents.status, "published")))
    .orderBy(asc(agents.createdAt)).limit(20);
  if (!rows.length) {
    await sendSafe({ token, chatId, text: "لا يوجد وكيل منشور متاح حاليًا. انشر وكيلًا من لوحة التحكم ثم أعد المحاولة." });
    return;
  }
  const text = rows.map((agent, index) => `${index + 1}. ${agent.name}${agent.description ? ` — ${agent.description.slice(0, 100)}` : ""}`).join("\n");
  await sendSafe({ token, chatId, text: `الوكلاء المتاحون:\n${text}`, buttonRows: [[{ id: "telegram.new", title: "بدء محادثة" }]] });
}

async function ensureRoutableConnection(account: TelegramAccount) {
  const bot = await centralTelegramBot();
  let connection = await ensureCentralTelegramChannelConnection({
    organizationId: account.organizationId,
    botId: String(bot.id),
    botUsername: bot.username,
    actorUserId: account.userId,
  });
  if (connection.defaultAgentId) return { bot, connection };

  const [binding] = await db().select({ agentId: channelAgentBindings.agentId }).from(channelAgentBindings).where(and(
    eq(channelAgentBindings.organizationId, account.organizationId),
    eq(channelAgentBindings.connectionId, connection.id),
    eq(channelAgentBindings.enabled, true),
  )).orderBy(asc(channelAgentBindings.priority)).limit(1);
  if (binding) return { bot, connection };

  const [fallbackAgent] = await db().select({ id: agents.id }).from(agents).where(and(
    eq(agents.organizationId, account.organizationId),
    eq(agents.status, "published"),
  )).orderBy(asc(agents.createdAt)).limit(1);
  if (!fallbackAgent) return { bot, connection };

  const [updated] = await db().update(channelConnections).set({
    defaultAgentId: fallbackAgent.id,
    updatedAt: new Date(),
  }).where(and(
    eq(channelConnections.id, connection.id),
    eq(channelConnections.organizationId, account.organizationId),
  )).returning();
  connection = updated ?? connection;
  return { bot, connection };
}

function syntheticCommandUpdate(update: TelegramUpdate, data: NonNullable<ReturnType<typeof messageData>>, command: string): TelegramUpdate {
  return {
    update_id: update.update_id,
    message: {
      ...data.message,
      from: data.user,
      text: command,
      caption: undefined,
    },
  };
}

function channelErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return SAFE_FAILURE_MESSAGE;
  const messages: Record<string, string> = {
    CHANNEL_AGENT_REQUIRED: "لا يوجد وكيل منشور مرتبط بقناة Telegram. انشر وكيلًا أو اربطه بالقناة من لوحة التحكم ثم أعد المحاولة.",
    CHANNEL_AGENT_UNAVAILABLE: "الوكيل المرتبط بقناة Telegram غير منشور أو غير متاح حاليًا.",
    CHANNEL_PROVIDER_UNAVAILABLE: "مزود الذكاء الاصطناعي المرتبط بالقناة غير متاح أو لم ينجح التحقق منه.",
    CHANNEL_MODEL_UNAVAILABLE: "النموذج المرتبط بقناة Telegram غير متاح في المزود المحدد.",
    CHANNEL_AI_FORBIDDEN: "الدردشة مع الوكيل غير مسموحة في إعدادات القناة الحالية.",
    CHANNEL_MONTHLY_LIMIT_REACHED: "تم الوصول إلى الحد الشهري المسموح لرسائل القناة.",
  };
  return messages[error.code] ?? SAFE_FAILURE_MESSAGE;
}

async function startNewConversation(input: {
  token: string;
  chatId: string;
  account: TelegramAccount;
  update: TelegramUpdate;
  data: NonNullable<ReturnType<typeof messageData>>;
}) {
  if (!await featureAllowedOrReply({ ...input, feature: "telegram.chat" })) return;
  const { bot, connection } = await ensureRoutableConnection(input.account);
  try {
    const normalized = telegramChannelAdapter.normalizeIncoming(
      syntheticCommandUpdate(input.update, input.data, "/new"),
      { externalAccountId: String(bot.id) },
    );
    if (!normalized.length) throw new Error("TELEGRAM_COMMAND_NORMALIZATION_FAILED");
    for (const incoming of normalized) await routeIncomingChannelMessage({ connection, incoming });
  } catch (error) {
    await sendSafe({ token: input.token, chatId: input.chatId, text: channelErrorMessage(error), buttonRows: MAIN_MENU });
  }
}

async function handleLinkedCommand(input: {
  command: CentralCommand;
  token: string;
  chatId: string;
  account: TelegramAccount;
  update: TelegramUpdate;
  data: NonNullable<ReturnType<typeof messageData>>;
}) {
  switch (input.command) {
    case "start":
      await sendMenu(input.token, input.chatId, "مرحبًا بك في بوت معتز. حسابك مرتبط وجاهز للاستخدام ✅");
      await sendSafe({ token: input.token, chatId: input.chatId, text: helpText() });
      break;
    case "help":
      await sendSafe({ token: input.token, chatId: input.chatId, text: helpText(), buttonRows: MAIN_MENU });
      break;
    case "status":
      await sendAccountStatus(input.token, input.chatId, input.account);
      break;
    case "agents":
      await sendAgents(input.token, input.chatId, input.account);
      break;
    case "new":
      await startNewConversation(input);
      break;
    case "files":
      if (await featureAllowedOrReply({ ...input, feature: "telegram.files" })) {
        await sendSafe({
          token: input.token,
          chatId: input.chatId,
          text: "أرسل الملف أو الصورة أو التسجيل مباشرة داخل المحادثة. الحد الأقصى للملف 20 ميجابايت، وتُطبق صلاحية نوع الوسائط قبل معالجته.",
          buttonRows: MAIN_MENU,
        });
      }
      break;
    case "unlink":
      await sendSafe({
        token: input.token,
        chatId: input.chatId,
        text: "هل تريد فصل حساب Telegram عن حساب المنصة؟",
        buttonRows: [[
          { id: "telegram.unlink_confirm", title: "تأكيد الفصل" },
          { id: "telegram.unlink_cancel", title: "إلغاء" },
        ]],
      });
      break;
    case "unlink_confirm":
      await unlinkTelegramAccount({
        userId: input.account.userId,
        organizationId: input.account.organizationId,
        actorUserId: input.account.userId,
      });
      await sendSafe({ token: input.token, chatId: input.chatId, text: "تم فصل حساب Telegram عن حساب المنصة." });
      break;
    case "unlink_cancel":
    case "cancel":
      await sendMenu(input.token, input.chatId, "تم إلغاء العملية الحالية.");
      break;
  }
  safeLog("info", "telegram.command.handled", { command: input.command });
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
      safeLog("info", "telegram.link.started", { updateRowId });
      await enforceRateLimit({
        scope: "telegram.link-code.consume",
        key: data.telegramUserId,
        limit: config.linkCodeMaxAttempts,
        windowMs: config.linkCodeTtlMinutes * 60_000,
      });
      let linked: Awaited<ReturnType<typeof consumeTelegramLinkCode>>;
      try {
        linked = await consumeTelegramLinkCode({
          code,
          telegramUserId: data.telegramUserId,
          telegramChatId: data.chatId,
          username: data.user.username,
          firstName: data.user.first_name,
          lastName: data.user.last_name,
        });
      } catch (error) {
        safeLog("error", "telegram.link.failed", {
          updateRowId,
          errorCode: error instanceof Error ? error.name.slice(0, 120) : "TELEGRAM_LINK_FAILED",
        });
        await sendSafe({ token: config.botToken, chatId: data.chatId, text: SAFE_FAILURE_MESSAGE });
        await markUpdate(updateRowId, "failed", "TELEGRAM_LINK_FAILED");
        return;
      }
      if (!linked.ok) {
        safeLog("warn", "telegram.link.failed", { updateRowId, errorCode: "TELEGRAM_LINK_INVALID" });
        await sendSafe({ token: config.botToken, chatId: data.chatId, text: INVALID_LINK_MESSAGE });
        await markUpdate(updateRowId, "ignored", "TELEGRAM_LINK_INVALID");
        return;
      }
      safeLog("info", "telegram.link.succeeded", { updateRowId });
      await sendSafe({
        token: config.botToken,
        chatId: data.chatId,
        text: "تم ربط حسابك بنجاح ✅",
        buttonRows: MAIN_MENU,
      });
      await sendSafe({ token: config.botToken, chatId: data.chatId, text: helpText() });
      await markUpdate(updateRowId, "completed");
      return;
    }

    const command = centralCommand(data.text);
    const account = await resolveTelegramAccount(data.telegramUserId);
    if (!account) {
      const text = command === "start" || command === "help"
        ? "مرحبًا بك في بوت معتز. حسابك غير مرتبط بعد. أنشئ رمز ربط من صفحة التكاملات في المنصة ثم افتح البوت من الرابط المخصص."
        : "حساب Telegram غير مرتبط. أنشئ رمز ربط جديدًا من إعدادات حسابك في منصة معتز.";
      const buttonRows = config.publicAppUrl
        ? [[{ title: "فتح إعدادات الربط", url: `${config.publicAppUrl.replace(/\/$/, "")}/dashboard/integrations` }]]
        : undefined;
      await sendSafe({ token: config.botToken, chatId: data.chatId, text, buttonRows });
      if (command === "help") await sendSafe({ token: config.botToken, chatId: data.chatId, text: helpText() });
      await markUpdate(updateRowId, "ignored", "TELEGRAM_ACCOUNT_NOT_LINKED");
      return;
    }

    if (command) {
      await handleLinkedCommand({ command, token: config.botToken, chatId: data.chatId, account, update, data });
      await markUpdate(updateRowId, "completed");
      return;
    }

    const feature = requiredFeature(data.message, data.text);
    if (!await featureAllowedOrReply({ token: config.botToken, chatId: data.chatId, account, feature })) {
      await markUpdate(updateRowId, "ignored", "TELEGRAM_FEATURE_DENIED");
      return;
    }

    const { bot, connection } = await ensureRoutableConnection(account);
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
    const errorCode = error instanceof ApiError
      ? error.code
      : error instanceof Error && /^[A-Z0-9_.:-]{1,120}$/.test(error.message)
        ? error.message
        : error instanceof Error ? error.name.slice(0, 120) : "TELEGRAM_PROCESSING_FAILED";
    await sendSafe({ token: config.botToken, chatId: data.chatId, text: SAFE_FAILURE_MESSAGE }).catch(() => undefined);
    await markUpdate(updateRowId, "failed", errorCode);
    safeLog("error", "telegram.central_update.failed", { updateRowId, errorCode });
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

  safeLog("info", "telegram.webhook.received", {
    updateId: update.update_id,
    updateType: update.callback_query ? "callback_query" : update.edited_message ? "edited_message" : "message",
  });

  if (update.callback_query?.id && config.botToken) {
    await answerTelegramCallback({ token: config.botToken, callbackQueryId: update.callback_query.id }).catch((error) => {
      safeLog("warn", "telegram.callback.answer_failed", {
        errorCode: error instanceof Error ? error.name.slice(0, 120) : "TELEGRAM_CALLBACK_ANSWER_FAILED",
      });
    });
  }

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
