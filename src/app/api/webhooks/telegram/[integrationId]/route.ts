// Deprecated compatibility route for historical per-organization Telegram integrations.
// The production central bot uses POST /api/webhooks/telegram and never reads organization bot tokens.
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations, telegramUpdates } from "@/db/schema";
import { ensureTelegramChannelConnection } from "@/lib/channels/connections";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import { telegramChannelAdapter } from "@/lib/channels/telegram-adapter";
import { apiSuccess, getRequestId } from "@/lib/http/api";
import { listGitHubRepositories, readGitHubFile } from "@/lib/integrations/github";
import { sendTelegramMessage } from "@/lib/integrations/telegram";
import { telegramPlatformConfig } from "@/lib/integrations/telegram-platform";
import { decryptSecret, secureHashEquals } from "@/lib/security/encryption";

export const runtime = "nodejs";

const MAX_TELEGRAM_WEBHOOK_BYTES = 1024 * 1024;

type TelegramUpdate = {
  update_id?: number;
  message?: { text?: string; caption?: string; chat?: { id?: number } };
  callback_query?: { data?: string; message?: { chat?: { id?: number } } };
};

function telegramText(update: TelegramUpdate) {
  return (update.message?.text ?? update.message?.caption ?? update.callback_query?.data ?? "").trim();
}

function telegramChatId(update: TelegramUpdate) {
  const value = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
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

async function processUpdate(input: {
  integration: typeof integrations.$inferSelect;
  update: TelegramUpdate;
  updateRowId: string;
}) {
  const token = decryptSecret(input.integration.encryptedToken, `integration:${input.integration.organizationId}`);
  try {
    const text = telegramText(input.update);
    const chatId = telegramChatId(input.update);
    if (!chatId) {
      await db().update(telegramUpdates).set({ status: "ignored", completedAt: new Date() })
        .where(eq(telegramUpdates.id, input.updateRowId));
      return;
    }
    if (text === "/github repos" || text.startsWith("/github read ")) {
      await sendTelegramMessage({ token, chatId, text: await githubCommand(input.integration.organizationId, text) });
    } else {
      const connection = await ensureTelegramChannelConnection({ integration: input.integration });
      const incoming = telegramChannelAdapter.normalizeIncoming(input.update, { externalAccountId: connection.externalAccountId });
      await Promise.all(incoming.map((message) => routeIncomingChannelMessage({ connection, incoming: message })));
    }
    await db().update(telegramUpdates).set({ status: "completed", completedAt: new Date() })
      .where(eq(telegramUpdates.id, input.updateRowId));
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "TELEGRAM_PROCESSING_FAILED";
    await db().update(telegramUpdates).set({ status: "failed", errorCode, completedAt: new Date() })
      .where(eq(telegramUpdates.id, input.updateRowId));
    const chatId = telegramChatId(input.update);
    if (chatId) {
      await sendTelegramMessage({ token, chatId, text: `تعذر إكمال الطلب (${errorCode}). راجع حالة القناة والوكيل والمزود.` }).catch(() => undefined);
    }
    console.error(JSON.stringify({
      level: "error",
      event: "telegram.channel_update.failed",
      integrationId: input.integration.id,
      updateId: input.update.update_id,
      errorCode,
    }));
  }
}

export async function POST(request: Request, context: { params: Promise<{ integrationId: string }> }) {
  const requestId = getRequestId(request);
  const central = telegramPlatformConfig();
  if (central.enabled && !central.allowUserBotTokens) {
    return new Response(null, { status: 410, headers: { "cache-control": "no-store" } });
  }
  const { integrationId } = await context.params;
  const [integration] = await db().select().from(integrations).where(and(
    eq(integrations.id, integrationId),
    eq(integrations.kind, "telegram"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).limit(1);
  if (!integration) return apiSuccess({ accepted: true }, requestId);
  const expectedHash = typeof integration.config.webhookSecretHash === "string" ? integration.config.webhookSecretHash : "";
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expectedHash || !suppliedSecret || !secureHashEquals(expectedHash, suppliedSecret)) return new Response(null, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_TELEGRAM_WEBHOOK_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_TELEGRAM_WEBHOOK_BYTES) return new Response(null, { status: 413 });
  const update = (() => { try { return JSON.parse(raw) as TelegramUpdate; } catch { return null; } })();
  if (!update || !Number.isSafeInteger(update.update_id)) return apiSuccess({ accepted: false }, requestId);
  let updateRow;
  try {
    [updateRow] = await db().insert(telegramUpdates).values({ integrationId: integration.id, updateId: String(update.update_id) })
      .returning({ id: telegramUpdates.id });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") return apiSuccess({ accepted: true, duplicate: true }, requestId);
    throw error;
  }
  if (updateRow) after(() => processUpdate({ integration, update, updateRowId: updateRow.id }));
  return apiSuccess({ accepted: true }, requestId);
}
