import { sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import { apiSuccess, getRequestId } from "@/lib/http/api";
import { answerTelegramCallback } from "@/lib/telegram/message-renderer";
import { parseTelegramUpdate } from "@/lib/telegram/update-parser";
import { telegramPlatformConfig, verifyTelegramWebhookSecret } from "@/lib/integrations/telegram-platform";
import { enqueueTelegramUpdate } from "@/worker/queue";

export const runtime = "nodejs";

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const config = telegramPlatformConfig();
  if (!config.enabled || config.updateMode !== "webhook" || !config.botToken) {
    return new Response(null, { status: 404 });
  }
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > config.webhookMaxBytes) {
    return new Response(null, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > config.webhookMaxBytes) {
    return new Response(null, { status: 413 });
  }

  let update;
  try {
    update = parseTelegramUpdate(JSON.parse(raw));
  } catch {
    return apiSuccess({ accepted: false }, requestId);
  }

  safeLog("info", "telegram.webhook.received", {
    updateId: update.update_id,
    updateType: update.callback_query ? "callback_query" : update.edited_message ? "edited_message" : "message",
  });

  if (update.callback_query?.id) {
    await answerTelegramCallback({
      token: config.botToken,
      callbackQueryId: update.callback_query.id,
    }).catch((error) => {
      safeLog("warn", "telegram.callback.answer_failed", {
        updateId: update.update_id,
        errorCode: error instanceof Error ? error.name.slice(0, 80) : "TELEGRAM_CALLBACK_ANSWER_FAILED",
      });
    });
  }

  let updateRowId: string;
  try {
    const inserted = await db().execute(sql`
      INSERT INTO "telegram_updates" ("integration_id", "update_id", "status")
      VALUES (NULL, ${String(update.update_id)}, 'accepted')
      RETURNING "id"
    `);
    const candidate = databaseRows(inserted)[0]?.id;
    if (typeof candidate !== "string") throw new Error("TELEGRAM_UPDATE_INSERT_FAILED");
    updateRowId = candidate;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") return apiSuccess({ accepted: true, duplicate: true }, requestId);
    safeLog("error", "telegram.webhook.persist_failed", { requestId, updateId: update.update_id });
    return new Response(null, { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } });
  }

  try {
    await enqueueTelegramUpdate({
      updateRowId,
      updateId: update.update_id,
      update: update as Record<string, unknown>,
    });
  } catch {
    safeLog("error", "telegram.webhook.enqueue_failed", { requestId, updateId: update.update_id, updateRowId });
    return new Response(null, { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } });
  }

  return apiSuccess({ accepted: true, queued: true }, requestId);
}
