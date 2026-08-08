import { eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramUpdates } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { consumeTelegramLinkCode, resolveTelegramAccount, telegramPlatformConfig, unlinkTelegramAccount } from "@/lib/integrations/telegram-platform";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { showTelegramAccountStatus } from "./account-flows";
import {
  chooseTelegramAgent,
  handleAgentCreateCallback,
  handleAgentCreateText,
  listTelegramAgents,
  showTelegramAgent,
  startCreateAgentFlow,
} from "./agent-flows";
import {
  confirmTelegramApprovalDecision,
  decideTelegramApproval,
  listTelegramApprovals,
  showTelegramApproval,
} from "./approval-flows";
import { assertTelegramCapability } from "./capability-registry";
import { handleTelegramConversationCallback, sendTelegramConversationMessage, startTelegramConversation } from "./conversation-flows";
import { presentTelegramError } from "./error-presenter";
import { handleTelegramMedia } from "./file-flows";
import {
  listTelegramMcp,
  listTelegramSiteConnections,
  showTelegramMcpServer,
  showTelegramSiteConnection,
} from "./integration-flows";
import { renderTelegramMainMenu } from "./menu-renderer";
import { answerTelegramCallback, sendTelegramError, sendTelegramMenu, sendTelegramText } from "./message-renderer";
import { listTelegramRepositories, showTelegramRepository } from "./repository-flows";
import { listTelegramBrowserTasks, listTelegramSandboxRuntime } from "./runtime-flows";
import { cancelTelegramFlow, ensureTelegramSession, getTelegramSession } from "./session-service";
import {
  confirmTelegramRunMutation,
  confirmTelegramTeamRun,
  executeTelegramRunMutation,
  handleTelegramTeamRunText,
  listTelegramRuns,
  listTelegramTeams,
  showTelegramRun,
  showTelegramTeam,
  startTelegramTeamRun,
} from "./team-flows";
import { parseTelegramUpdate, telegramUpdateContext, type TelegramUpdate } from "./update-parser";

const INVALID_LINK_MESSAGE = "رمز الربط غير صالح أو انتهت صلاحيته. أنشئ رمزًا جديدًا من إعدادات حسابك.";

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

function linkCode(text: string) {
  const start = /^\/start(?:@\w+)?\s+link_(\d{6,10})$/i.exec(text.trim());
  if (start) return start[1];
  const plain = /^(?:ربط\s+)?(\d{6,10})$/u.exec(text.trim());
  return plain?.[1] ?? null;
}

function command(text: string) {
  const normalized = text.trim().toLowerCase().replace(/@\w+$/, "");
  if (!normalized.startsWith("/")) return null;
  return normalized.slice(1).split(/\s+/, 1)[0] ?? null;
}

async function markUpdate(id: string, status: "completed" | "failed" | "ignored", errorCode?: string) {
  await db().update(telegramUpdates).set({
    status,
    errorCode: errorCode ?? null,
    completedAt: new Date(),
  }).where(eq(telegramUpdates.id, id));
}

async function showTelegramFileHelp(input: {
  token: string;
  chatId: string;
  userId: string;
  organizationId: string;
}) {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "files.receive",
  });
  if (!capability) {
    throw new ApiError(403, "TELEGRAM_FILES_CAPABILITY_DENIED", "إرسال الملفات غير مفعّل لحسابك.");
  }
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: [
      "الرئيسية ← المحتوى والمعرفة ← الملفات والوسائط",
      "أرسل الملف أو الصورة أو التسجيل الصوتي أو الفيديو مباشرة إلى البوت.",
      "لا تُرسل رسالة نجاح قبل أن يكتمل تنزيل الوسيط والتحقق منه وتخزينه وربطه بالمحادثة الحقيقية.",
      "إذا لم تختر وكيلًا بعد فسيطلب منك البوت اختيار وكيل منشور أولًا.",
    ].join("\n"),
    buttonRows: [[{ id: "chat:start", title: "اختيار محادثة" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}

async function handleLink(input: {
  updateRowId: string;
  update: TelegramUpdate;
  code: string;
  token: string;
  context: NonNullable<ReturnType<typeof telegramUpdateContext>>;
}) {
  const config = telegramPlatformConfig();
  safeLog("info", "telegram.link.started", { updateRowId: input.updateRowId });
  await enforceRateLimit({
    scope: "telegram.link-code.consume",
    key: input.context.telegramUserId,
    limit: config.linkCodeMaxAttempts,
    windowMs: config.linkCodeTtlMinutes * 60_000,
  });
  const linked = await consumeTelegramLinkCode({
    code: input.code,
    telegramUserId: input.context.telegramUserId,
    telegramChatId: input.context.chatId,
    username: input.context.user.username,
    firstName: input.context.user.first_name,
    lastName: input.context.user.last_name,
  });
  if (!linked.ok) {
    safeLog("warn", "telegram.link.failed", { updateRowId: input.updateRowId, errorCode: "TELEGRAM_LINK_INVALID" });
    await sendTelegramError({ token: input.token, chatId: input.context.chatId, text: INVALID_LINK_MESSAGE });
    await markUpdate(input.updateRowId, "ignored", "TELEGRAM_LINK_INVALID");
    return;
  }
  await ensureTelegramSession({
    userId: linked.userId,
    organizationId: linked.organizationId,
    telegramUserId: input.context.telegramUserId,
    telegramChatId: input.context.chatId,
  });
  safeLog("info", "telegram.link.succeeded", { updateRowId: input.updateRowId });
  await renderTelegramMainMenu({
    token: input.token,
    chatId: input.context.chatId,
    userId: linked.userId,
    organizationId: linked.organizationId,
    title: "تم ربط حسابك بنجاح ✅\nيمكنك الآن استخدام القدرات المتاحة فعليًا لحسابك.",
  });
  await markUpdate(input.updateRowId, "completed");
}

async function handleCallback(input: {
  token: string;
  context: NonNullable<ReturnType<typeof telegramUpdateContext>>;
  account: NonNullable<Awaited<ReturnType<typeof resolveTelegramAccount>>>;
  action: string;
}) {
  const base = {
    token: input.token,
    chatId: input.context.chatId,
    telegramUserId: input.context.telegramUserId,
    userId: input.account.userId,
    organizationId: input.account.organizationId,
  };
  if (await handleAgentCreateCallback({ ...base, action: input.action })) return;
  if (await handleTelegramConversationCallback({ ...base, action: input.action })) return;

  if (input.action === "nav:home") {
    await renderTelegramMainMenu({ ...base });
    return;
  }

  const teamsPage = /^teams:page:(\d+)$/.exec(input.action);
  if (teamsPage) {
    await listTelegramTeams({ ...base, page: Number(teamsPage[1]) });
    return;
  }
  const teamView = /^team:view:([0-9a-f-]{36})$/i.exec(input.action);
  if (teamView) {
    await showTelegramTeam({ ...base, teamId: teamView[1] });
    return;
  }
  const teamRun = /^team:run:([0-9a-f-]{36})$/i.exec(input.action);
  if (teamRun) {
    await startTelegramTeamRun({ ...base, teamId: teamRun[1] });
    return;
  }
  if (input.action === "team:run:confirm") {
    await confirmTelegramTeamRun({ ...base, requestId: `telegram:team:${input.context.updateId}:${input.context.message.message_id ?? 0}` });
    return;
  }
  const runsPage = /^runs:page:(\d+)$/.exec(input.action);
  if (runsPage) {
    await listTelegramRuns({ ...base, page: Number(runsPage[1]) });
    return;
  }
  const runView = /^run:view:([0-9a-f-]{36})$/i.exec(input.action);
  if (runView) {
    await showTelegramRun({ ...base, runId: runView[1] });
    return;
  }
  const runConfirm = /^run:(cancel|retry):confirm:([0-9a-f-]{36})$/i.exec(input.action);
  if (runConfirm) {
    await confirmTelegramRunMutation({ ...base, operation: runConfirm[1] as "cancel" | "retry", runId: runConfirm[2] });
    return;
  }
  const runExecute = /^run:(cancel|retry):execute:([0-9a-f-]{36})$/i.exec(input.action);
  if (runExecute) {
    await executeTelegramRunMutation({ ...base, operation: runExecute[1] as "cancel" | "retry", runId: runExecute[2] });
    return;
  }

  if (input.action === "approvals:list") {
    await listTelegramApprovals(base);
    return;
  }
  const approvalView = /^approval:view:([0-9a-f-]{36})$/i.exec(input.action);
  if (approvalView) {
    await showTelegramApproval({ ...base, approvalId: approvalView[1] });
    return;
  }
  const approvalConfirm = /^approval:confirm:([0-9a-f-]{36}):(approve|reject)$/i.exec(input.action);
  if (approvalConfirm) {
    await confirmTelegramApprovalDecision({ ...base, approvalId: approvalConfirm[1], decision: approvalConfirm[2] as "approve" | "reject" });
    return;
  }
  const approvalDecision = /^approval:decide:([0-9a-f-]{36}):(approve|reject)$/i.exec(input.action);
  if (approvalDecision) {
    await decideTelegramApproval({ ...base, approvalId: approvalDecision[1], decision: approvalDecision[2] as "approve" | "reject" });
    return;
  }

  if (input.action === "agents:list" || input.action === "agents:select") {
    await listTelegramAgents({ ...base, mode: input.action === "agents:select" ? "select" : "browse" });
    return;
  }
  const pageMatch = /^agents:page:(\d+):(browse|select)$/.exec(input.action);
  if (pageMatch) {
    await listTelegramAgents({ ...base, page: Number(pageMatch[1]), mode: pageMatch[2] as "browse" | "select" });
    return;
  }
  if (input.action === "agents:create") {
    await startCreateAgentFlow(base);
    return;
  }
  const viewMatch = /^agent:view:([0-9a-f-]{36})$/.exec(input.action);
  if (viewMatch) {
    await showTelegramAgent({ ...base, agentId: viewMatch[1] });
    return;
  }
  const chooseMatch = /^agent:choose:([0-9a-f-]{36})$/.exec(input.action);
  if (chooseMatch) {
    await chooseTelegramAgent({ ...base, agentId: chooseMatch[1] });
    return;
  }
  if (input.action === "chat:start" || input.action === "chat:new") {
    await startTelegramConversation(base);
    return;
  }
  if (input.action === "files:help") {
    await showTelegramFileHelp(base);
    return;
  }
  if (input.action === "repositories:list") {
    await listTelegramRepositories(base);
    return;
  }
  const repositoryView = /^repository:view:(\d+)$/.exec(input.action);
  if (repositoryView) {
    await showTelegramRepository({ ...base, repositoryId: Number(repositoryView[1]) });
    return;
  }
  if (input.action === "connections:list") {
    await listTelegramSiteConnections(base);
    return;
  }
  const connectionView = /^connection:view:([0-9a-f-]{36})$/i.exec(input.action);
  if (connectionView) {
    await showTelegramSiteConnection({ ...base, connectionId: connectionView[1] });
    return;
  }
  if (input.action === "mcp:list") {
    await listTelegramMcp(base);
    return;
  }
  const mcpView = /^mcp:view:([0-9a-f-]{36})$/i.exec(input.action);
  if (mcpView) {
    await showTelegramMcpServer({ ...base, serverId: mcpView[1] });
    return;
  }
  if (input.action === "browser:list") {
    await listTelegramBrowserTasks(base);
    return;
  }
  if (input.action === "sandbox:list") {
    await listTelegramSandboxRuntime(base);
    return;
  }
  if (input.action === "account:status") {
    await showTelegramAccountStatus({
      ...base,
      telegramUsername: input.account.telegramUsername,
      linkedAt: input.account.linkedAt,
      lastSeenAt: input.account.lastSeenAt,
    });
    return;
  }
  if (input.action === "account:unlink") {
    await sendTelegramMenu({
      token: input.token,
      chatId: input.context.chatId,
      title: "هل تريد فصل حساب Telegram عن المنصة؟",
      buttonRows: [[{ id: "account:unlink:confirm", title: "تأكيد الفصل" }, { id: "nav:home", title: "إلغاء" }]],
    });
    return;
  }
  if (input.action === "account:unlink:confirm") {
    await unlinkTelegramAccount({ userId: input.account.userId, organizationId: input.account.organizationId, actorUserId: input.account.userId });
    await sendTelegramText({ token: input.token, chatId: input.context.chatId, text: "تم فصل حساب Telegram عن المنصة." });
    return;
  }
  if (input.action === "flow:cancel") {
    const cancelled = await cancelTelegramFlow(input.context.telegramUserId);
    await sendTelegramText({ token: input.token, chatId: input.context.chatId, text: cancelled?.activeFlow ? "تم إلغاء العملية الحالية." : "لا توجد عملية نشطة لإلغائها." });
    return;
  }
  await renderTelegramMainMenu({ ...base, title: "الإجراء غير متاح أو انتهت صلاحيته. اختر من القائمة الحالية." });
}

async function handleLinkedText(input: {
  token: string;
  updateRowId: string;
  update: TelegramUpdate;
  context: NonNullable<ReturnType<typeof telegramUpdateContext>>;
  account: NonNullable<Awaited<ReturnType<typeof resolveTelegramAccount>>>;
}) {
  const base = {
    token: input.token,
    chatId: input.context.chatId,
    telegramUserId: input.context.telegramUserId,
    userId: input.account.userId,
    organizationId: input.account.organizationId,
  };
  const cmd = command(input.context.text);
  if (cmd === "cancel") {
    const session = await getTelegramSession(input.context.telegramUserId);
    if (session?.activeFlow) {
      await cancelTelegramFlow(input.context.telegramUserId);
      await sendTelegramText({ token: input.token, chatId: input.context.chatId, text: "تم إلغاء العملية الحالية." });
    } else {
      await sendTelegramText({ token: input.token, chatId: input.context.chatId, text: "لا توجد عملية نشطة لإلغائها." });
    }
    return;
  }
  if (cmd === "start" || cmd === "help") {
    const session = await getTelegramSession(input.context.telegramUserId);
    await renderTelegramMainMenu({
      ...base,
      title: session?.activeFlow
        ? "الرئيسية\nلديك عملية غير مكتملة محفوظة. يمكنك العودة إليها أو استخدام /cancel لإلغائها."
        : "مرحبًا بك في بوت معتز. تظهر هنا فقط القدرات المتاحة فعليًا لحسابك.",
    });
    return;
  }
  if (cmd === "agents") { await listTelegramAgents({ ...base, mode: "browse" }); return; }
  if (cmd === "teams") { await listTelegramTeams({ ...base, page: 1 }); return; }
  if (cmd === "runs") { await listTelegramRuns({ ...base, page: 1 }); return; }
  if (cmd === "approvals") { await listTelegramApprovals(base); return; }
  if (cmd === "new") { await startTelegramConversation(base); return; }
  if (cmd === "files") { await showTelegramFileHelp(base); return; }
  if (cmd === "github" || cmd === "repos" || cmd === "repositories") { await listTelegramRepositories(base); return; }
  if (cmd === "connections" || cmd === "sites") { await listTelegramSiteConnections(base); return; }
  if (cmd === "mcp") { await listTelegramMcp(base); return; }
  if (cmd === "browser") { await listTelegramBrowserTasks(base); return; }
  if (cmd === "sandbox") { await listTelegramSandboxRuntime(base); return; }
  if (cmd === "status") {
    await showTelegramAccountStatus({ ...base, telegramUsername: input.account.telegramUsername, linkedAt: input.account.linkedAt, lastSeenAt: input.account.lastSeenAt });
    return;
  }
  if (cmd === "unlink") {
    await sendTelegramMenu({
      token: input.token,
      chatId: input.context.chatId,
      title: "تأكيد فصل حساب Telegram:",
      buttonRows: [[{ id: "account:unlink:confirm", title: "تأكيد الفصل" }, { id: "nav:home", title: "إلغاء" }]],
    });
    return;
  }

  if (await handleTelegramMedia({ ...base, update: input.update, requestId: `telegram:media:${input.context.updateId}:${input.context.message.message_id}` })) return;
  if (await handleTelegramTeamRunText({ ...base, text: input.context.text })) return;
  if (await handleAgentCreateText({ ...base, text: input.context.text })) return;

  await sendTelegramConversationMessage({
    ...base,
    text: input.context.text,
    requestId: `telegram:${input.context.updateId}:${input.context.message.message_id}`,
  });
}

export async function processTelegramUpdate(input: { updateRowId: string; update: unknown }) {
  const config = telegramPlatformConfig();
  if (!config.enabled || !config.botToken) throw new Error("TELEGRAM_DISABLED");
  const update = parseTelegramUpdate(input.update);
  const context = telegramUpdateContext(update);
  if (!context) {
    await markUpdate(input.updateRowId, "ignored", "TELEGRAM_UPDATE_UNSUPPORTED");
    return;
  }

  try {
    if (context.callbackId) {
      await answerTelegramCallback({ token: config.botToken, callbackQueryId: context.callbackId }).catch((error) => {
        safeLog("warn", "telegram.callback.answer_failed", {
          updateRowId: input.updateRowId,
          updateId: context.updateId,
          errorCode: error instanceof Error ? error.name.slice(0, 80) : "TELEGRAM_CALLBACK_ANSWER_FAILED",
        });
      });
    }
    const code = linkCode(context.text);
    if (code) {
      await handleLink({ updateRowId: input.updateRowId, update, code, token: config.botToken, context });
      return;
    }
    const account = await resolveTelegramAccount(context.telegramUserId);
    if (!account) {
      await sendTelegramMenu({
        token: config.botToken,
        chatId: context.chatId,
        title: "حساب Telegram غير مرتبط. أنشئ رمز ربط من صفحة التكاملات في الموقع ثم افتح رابط البوت.",
        buttonRows: [[{ url: `${config.publicAppUrl?.replace(/\/$/, "")}/dashboard/integrations`, title: "فتح صفحة الربط" }]],
      });
      await markUpdate(input.updateRowId, "ignored", "TELEGRAM_ACCOUNT_NOT_LINKED");
      return;
    }
    await ensureTelegramSession({
      userId: account.userId,
      organizationId: account.organizationId,
      telegramUserId: context.telegramUserId,
      telegramChatId: context.chatId,
    });
    if (context.callbackData) await handleCallback({ token: config.botToken, context, account, action: context.callbackData });
    else await handleLinkedText({ token: config.botToken, updateRowId: input.updateRowId, update, context, account });
    await markUpdate(input.updateRowId, "completed");
    safeLog("info", "telegram.command.handled", { updateRowId: input.updateRowId, updateId: context.updateId });
  } catch (error) {
    const referenceId = crypto.randomUUID();
    const presented = presentTelegramError(error, referenceId);
    await sendTelegramError({
      token: config.botToken,
      chatId: context.chatId,
      text: presented.message,
      referenceId: presented.referenceId,
      buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
    }).catch(() => undefined);
    await markUpdate(input.updateRowId, "failed", presented.code);
    safeLog("error", "telegram.update.failed", { updateRowId: input.updateRowId, errorCode: presented.code, referenceId });
  }
}
