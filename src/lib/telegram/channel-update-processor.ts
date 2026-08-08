import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations, telegramUpdates } from "@/db/schema";
import { ensureTelegramChannelConnection } from "@/lib/channels/connections";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import { telegramChannelAdapter } from "@/lib/channels/telegram-adapter";
import { listGitHubRepositories, readGitHubFile } from "@/lib/integrations/github";
import { sendTelegramMessage } from "@/lib/integrations/telegram";
import { decryptSecret } from "@/lib/security/encryption";

type TelegramUpdate = {
  update_id?: number;
  message?: { text?: string; caption?: string; chat?: { id?: number } };
  edited_message?: { text?: string; caption?: string; chat?: { id?: number } };
  callback_query?: { data?: string; message?: { chat?: { id?: number } } };
};

function telegramText(update: TelegramUpdate) {
  return (
    update.message?.text
    ?? update.message?.caption
    ?? update.edited_message?.text
    ?? update.edited_message?.caption
    ?? update.callback_query?.data
    ?? ""
  ).trim();
}

function telegramChatId(update: TelegramUpdate) {
  const value = update.message?.chat?.id
    ?? update.edited_message?.chat?.id
    ?? update.callback_query?.message?.chat?.id;
  return value === undefined ? null : String(value);
}

async function githubCommand(organizationId: string, command: string) {
  const [github] = await db().select().from(integrations).where(and(
    eq(integrations.organizationId, organizationId),
    eq(integrations.kind, "github"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).limit(1);
  if (!github) return "لم يُفعّل تكامل GitHub لهذه المؤسسة.";
  const token = decryptSecret(github.encryptedToken, `integration:${organizationId}`);
  const readMatch = command.match(/^\/github\s+read\s+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\s+(\S+)(?:\s+(\S+))?$/);
  if (readMatch) {
    const [, owner, repo, path, ref] = readMatch;
    const file = await readGitHubFile(token, owner, repo, path, ref);
    if (!file.content) return `الملف ${file.path} لا يحتوي نصًا قابلًا للعرض.`;
    const content = file.encoding === "base64"
      ? Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8")
      : file.content;
    return `${file.path} @ ${file.sha.slice(0, 8)}\n\n${content.slice(0, 3500)}`;
  }
  const repositories = await listGitHubRepositories(token, 15);
  if (repositories.length === 0) return "لا توجد مستودعات متاحة للتوكن الحالي.";
  return repositories.map((repo, index) =>
    `${index + 1}. ${repo.full_name} — ${repo.private ? "خاص" : "عام"} — ${repo.default_branch}`,
  ).join("\n");
}

async function markUpdate(id: string, status: "completed" | "failed" | "ignored", errorCode?: string) {
  await db().update(telegramUpdates).set({
    status,
    errorCode: errorCode ?? null,
    completedAt: new Date(),
  }).where(eq(telegramUpdates.id, id));
}

export async function processTelegramChannelUpdate(input: {
  integrationId: string;
  organizationId: string;
  updateRowId: string;
  update: unknown;
}) {
  const [integration] = await db().select().from(integrations).where(and(
    eq(integrations.id, input.integrationId),
    eq(integrations.organizationId, input.organizationId),
    eq(integrations.kind, "telegram"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).limit(1);
  if (!integration) {
    await markUpdate(input.updateRowId, "ignored", "TELEGRAM_INTEGRATION_UNAVAILABLE");
    return;
  }

  const update = input.update && typeof input.update === "object" && !Array.isArray(input.update)
    ? input.update as TelegramUpdate
    : null;
  if (!update || !Number.isSafeInteger(update.update_id)) {
    await markUpdate(input.updateRowId, "ignored", "TELEGRAM_UPDATE_INVALID");
    return;
  }

  const token = decryptSecret(integration.encryptedToken, `integration:${integration.organizationId}`);
  const chatId = telegramChatId(update);
  try {
    if (!chatId) {
      await markUpdate(input.updateRowId, "ignored", "TELEGRAM_CHAT_UNAVAILABLE");
      return;
    }
    const text = telegramText(update);
    if (text === "/start" || text === "/help") {
      const agentConfigured = typeof integration.config.agentId === "string";
      await sendTelegramMessage({
        token,
        chatId,
        text: agentConfigured
          ? "البوت مرتبط مباشرة بمنصة معتز. أرسل رسالتك أو ملفاتك وسيتم توجيهها إلى الوكيل المرتبط بهذه القناة. لا تحتاج إلى ربط حسابك بالبوت المركزي."
          : "البوت مرتبط بالمنصة، لكن يجب على مدير المؤسسة اختيار وكيل منشور لهذه القناة قبل بدء المحادثات.",
      });
      await markUpdate(input.updateRowId, "completed");
      return;
    }
    if (text === "/github repos" || text.startsWith("/github read ")) {
      await sendTelegramMessage({ token, chatId, text: await githubCommand(integration.organizationId, text) });
      await markUpdate(input.updateRowId, "completed");
      return;
    }

    const connection = await ensureTelegramChannelConnection({ integration });
    const incoming = telegramChannelAdapter.normalizeIncoming(update, { externalAccountId: connection.externalAccountId });
    if (incoming.length === 0) {
      await markUpdate(input.updateRowId, "ignored", "TELEGRAM_UPDATE_UNSUPPORTED");
      return;
    }
    for (const message of incoming) {
      await routeIncomingChannelMessage({ connection, incoming: message });
    }
    await markUpdate(input.updateRowId, "completed");
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "TELEGRAM_PROCESSING_FAILED";
    await markUpdate(input.updateRowId, "failed", errorCode);
    if (chatId) {
      await sendTelegramMessage({
        token,
        chatId,
        text: "تعذر إكمال الطلب الآن. تحقق من أن القناة والوكيل والمزود وأدوات MCP المطلوبة بحالة سليمة ثم حاول مجددًا.",
      }).catch(() => undefined);
    }
    console.error(JSON.stringify({
      level: "error",
      event: "telegram.channel_update.failed",
      integrationId: input.integrationId,
      organizationId: input.organizationId,
      updateId: update.update_id,
      errorCode,
    }));
    throw error;
  }
}
