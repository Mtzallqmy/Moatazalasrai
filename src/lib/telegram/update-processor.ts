import { getPostgresPool } from "@/db/pool";
import { ApiError } from "@/lib/http/api";
import {
  consumeTelegramLinkCode,
  resolveTelegramAccount,
  telegramPlatformConfig,
} from "@/lib/integrations/telegram-platform";
import { routeTelegramCallback } from "@/lib/telegram/callback-router";
import { routeTelegramCommand } from "@/lib/telegram/command-router";
import { handleAgentCreationText } from "@/lib/telegram/agent-flows";
import { handleConversationText, openConversation } from "@/lib/telegram/conversation-flows";
import { presentTelegramError } from "@/lib/telegram/error-presenter";
import { handleIncomingAttachments } from "@/lib/telegram/file-flows";
import { renderTelegramHome } from "@/lib/telegram/menu-renderer";
import { sendTelegramError, sendTelegramMenu, sendTelegramText } from "@/lib/telegram/message-renderer";
import {
  actorForTelegramSession,
  getOrCreateTelegramSession,
} from "@/lib/telegram/session-service";
import { handleTeamRunText } from "@/lib/telegram/team-flows";
import type { TelegramActionContext, TelegramLinkedAccount } from "@/lib/telegram/types";
import { parseTelegramUpdate, telegramCommand } from "@/lib/telegram/update-parser";

async function claimUpdate(updateRowId: string) {
  const result = await getPostgresPool().query<{
    id: string;
    status: string;
    payload: Record<string, unknown>;
  }>(`
    UPDATE telegram_updates
       SET status = 'processing',
           processing_attempts = processing_attempts + 1,
           last_processed_at = now()
     WHERE id = $1
       AND status IN ('received', 'queued', 'failed', 'processing')
     RETURNING id, status, payload
  `, [updateRowId]);
  return result.rows[0] ?? null;
}

async function finishUpdate(updateRowId: string, status: "completed" | "failed" | "ignored", errorCode?: string) {
  await getPostgresPool().query(`
    UPDATE telegram_updates
       SET status = $2,
           error_code = $3,
           completed_at = now(),
           last_processed_at = now()
     WHERE id = $1
  `, [updateRowId, status, errorCode ?? null]);
}

function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "info", event, ...fields }));
}

async function unlinkedUpdate(update: ReturnType<typeof parseTelegramUpdate>, dashboardUrl: string) {
  const command = telegramCommand(update.text);
  if (command?.name === "start" && /^link_\d{6,10}$/.test(command.argument)) {
    log("telegram.link.started", { updateId: update.updateId, telegramUserId: update.telegramUserId });
    const result = await consumeTelegramLinkCode({
      code: command.argument.slice("link_".length),
      telegramUserId: update.telegramUserId,
      telegramChatId: update.chatId,
      username: update.user.username,
      firstName: update.user.firstName,
      lastName: update.user.lastName,
    });
    if (!result.ok) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "telegram.link.failed",
        updateId: update.updateId,
        telegramUserId: update.telegramUserId,
        reason: "LINK_CODE_REJECTED",
      }));
      await sendTelegramError({
        chatId: update.chatId,
        text: "تعذر استخدام رمز الربط. قد يكون منتهيًا أو مستخدمًا سابقًا. أنشئ رمزًا جديدًا من الموقع.",
        buttonRows: [[{ title: "فتح إعدادات Telegram", url: `${dashboardUrl}/dashboard/integrations` }]],
      });
      return null;
    }
    const account = await resolveTelegramAccount(update.telegramUserId);
    if (!account) throw new ApiError(500, "TELEGRAM_LINK_NOT_PERSISTED", "تم قبول الرمز لكن تعذر تحميل الرابط.");
    const session = await getOrCreateTelegramSession({
      userId: account.userId,
      organizationId: account.organizationId,
      telegramUserId: update.telegramUserId,
      telegramChatId: update.chatId,
    });
    const actor = await actorForTelegramSession(session);
    const context: TelegramActionContext = {
      update,
      account: account as TelegramLinkedAccount,
      session,
      actor,
      page: 1,
      dashboardUrl,
    };
    log("telegram.link.succeeded", { updateId: update.updateId, userId: account.userId, organizationId: account.organizationId });
    await sendTelegramText({ chatId: update.chatId, text: "تم ربط حسابك بنجاح ✅" });
    await renderTelegramHome(context);
    return context;
  }

  await sendTelegramMenu({
    chatId: update.chatId,
    title: "مرحبًا بك في منصة معتز",
    description: command?.name === "start"
      ? "هذا الحساب غير مرتبط بالمنصة. أنشئ رمز ربط جديدًا من الموقع ثم افتح رابط البوت الناتج."
      : "يجب ربط حساب Telegram بحساب المنصة قبل استخدام القدرات.",
    buttonRows: [[{ title: "فتح إعدادات Telegram", url: `${dashboardUrl}/dashboard/integrations` }]],
  });
  return null;
}

async function processLinkedUpdate(context: TelegramActionContext) {
  if (context.update.kind === "my_chat_member") return;
  if (context.update.kind === "callback_query") {
    await routeTelegramCallback(context);
    log("telegram.command.handled", { updateId: context.update.updateId, kind: "callback", action: context.update.callbackData });
    return;
  }
  if (context.update.kind === "edited_message") {
    await sendTelegramMenu({
      chatId: context.update.chatId,
      title: "تم استلام تعديل الرسالة",
      description: "لا يعاد تشغيل الوكيل تلقائيًا عند تعديل رسالة سابقة. أرسل رسالة جديدة لتنفيذ طلب جديد.",
      buttonRows: [[{ id: "chat:open", title: "فتح المحادثة" }, { id: "nav:home", title: "الرئيسية" }]],
    });
    return;
  }
  if (context.update.attachments.length > 0 && await handleIncomingAttachments(context)) return;

  const command = telegramCommand(context.update.text);
  if (command && ["start", "help", "status", "agents", "new", "files", "unlink", "cancel"].includes(command.name)) {
    await routeTelegramCommand(context);
    log("telegram.command.handled", { updateId: context.update.updateId, kind: "command", command: command.name });
    return;
  }
  if (await handleAgentCreationText(context, context.update.text)) return;
  if (await handleTeamRunText(context, context.update.text)) return;
  if (await handleConversationText(context, context.update.text)) return;
  await openConversation(context);
}

export async function processTelegramUpdateRow(input: { updateRowId: string }) {
  const row = await claimUpdate(input.updateRowId);
  if (!row) return { ignored: true as const };
  let update: ReturnType<typeof parseTelegramUpdate> | null = null;
  try {
    update = parseTelegramUpdate(row.payload);
    log("telegram.webhook.processing", { updateRowId: row.id, updateId: update.updateId, kind: update.kind });
    const config = telegramPlatformConfig();
    const dashboardUrl = config.publicAppUrl?.replace(/\/$/, "");
    if (!dashboardUrl) throw new ApiError(503, "PUBLIC_APP_URL_MISSING", "رابط المنصة العام غير مهيأ.");
    const account = await resolveTelegramAccount(update.telegramUserId);
    if (!account) {
      await unlinkedUpdate(update, dashboardUrl);
      await finishUpdate(input.updateRowId, "completed");
      return { completed: true as const, linked: false as const };
    }
    const session = await getOrCreateTelegramSession({
      userId: account.userId,
      organizationId: account.organizationId,
      telegramUserId: update.telegramUserId,
      telegramChatId: update.chatId,
    });
    const actor = await actorForTelegramSession(session);
    const context: TelegramActionContext = {
      update,
      account: account as TelegramLinkedAccount,
      session,
      actor,
      page: 1,
      dashboardUrl,
    };
    await processLinkedUpdate(context);
    await finishUpdate(input.updateRowId, "completed");
    return { completed: true as const, linked: true as const };
  } catch (error) {
    const presented = presentTelegramError(error);
    console.error(JSON.stringify({
      level: "error",
      event: "telegram.update.failed",
      updateRowId: input.updateRowId,
      updateId: update?.updateId ?? null,
      code: presented.code,
      referenceId: presented.referenceId ?? null,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    if (update) {
      await sendTelegramError({
        chatId: update.chatId,
        text: presented.text,
        referenceId: presented.referenceId,
        buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
      }).catch(() => undefined);
    }
    await finishUpdate(input.updateRowId, "failed", presented.code).catch(() => undefined);
    if (!(error instanceof ApiError) || error.status >= 500) throw error;
    return { completed: false as const, errorCode: presented.code };
  }
}
