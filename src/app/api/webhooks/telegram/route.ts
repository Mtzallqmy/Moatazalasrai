import { sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import { apiSuccess, getRequestId } from "@/lib/http/api";
import { answerTelegramCallback } from "@/lib/telegram/message-renderer";
import { parseTelegramUpdate } from "@/lib/telegram/update-parser";
import { telegramPlatformConfig, verifyTelegramWebhookSecret } from "@/lib/integrations/telegram-platform";
import { enqueueTelegramUpdate } from "@/worker/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

async function persistCentralUpdate(updateId: number) {
  const inserted = await db().execute(sql`
    INSERT INTO "telegram_updates" ("integration_id", "update_id", "status")
    VALUES (NULL, ${String(updateId)}, 'accepted')
    ON CONFLICT DO NOTHING
    RETURNING "id", "status", "error_code"
  `);
  const insertedRow = databaseRows(inserted)[0];
  if (typeof insertedRow?.id === "string") {
    return { id: insertedRow.id, status: String(insertedRow.status ?? "accepted"), errorCode: insertedRow.error_code ?? null, duplicate: false };
  }
  const existing = await db().execute(sql`
    SELECT "id", "status", "error_code"
    FROM "telegram_updates"
    WHERE "integration_id" IS NULL AND "update_id" = ${String(updateId)}
    LIMIT 1
  `);
  const row = databaseRows(existing)[0];
  if (typeof row?.id !== "string") throw new Error("TELEGRAM_UPDATE_PERSISTENCE_INCONSISTENT");
  return { id: row.id, status: String(row.status ?? "accepted"), errorCode: row.error_code ?? null, duplicate: true };
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
  if (Number.isFinite(length) && length > config.webhookMaxBytes) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > config.webhookMaxBytes) return new Response(null, { status: 413 });

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
    await answerTelegramCallback({ token: config.botToken, callbackQueryId: update.callback_query.id }).catch((error) => {
      safeLog("warn", "telegram.callback.answer_failed", {
        updateId: update.update_id,
        errorCode: error instanceof Error ? error.name.slice(0, 80) : "TELEGRAM_CALLBACK_ANSWER_FAILED",
      });
    });
  }

  let persisted: Awaited<ReturnType<typeof persistCentralUpdate>>;
  try {
    persisted = await persistCentralUpdate(update.update_id);
  } catch {
    safeLog("error", "telegram.webhook.persist_failed", { requestId, updateId: update.update_id });
    return new Response(null, { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } });
  }

  if (persisted.duplicate && (persisted.status === "completed" || persisted.status === "ignored")) {
    return apiSuccess({ accepted: true, duplicate: true, terminal: true }, requestId);
  }
  if (persisted.duplicate && persisted.status === "failed" && persisted.errorCode !== "TELEGRAM_QUEUE_UNAVAILABLE") {
    return apiSuccess({ accepted: true, duplicate: true, terminal: true }, requestId);
  }

  try {
    await enqueueTelegramUpdate({
      updateRowId: persisted.id,
      updateId: update.update_id,
      update: update as Record<string, unknown>,
    });
    await db().execute(sql`
      UPDATE "telegram_updates"
      SET "status" = 'accepted', "error_code" = NULL, "completed_at" = NULL
      WHERE "id" = ${persisted.id}
    `);
  } catch {
    await db().execute(sql`
      UPDATE "telegram_updates"
      SET "status" = 'accepted', "error_code" = 'TELEGRAM_QUEUE_UNAVAILABLE', "completed_at" = NULL
      WHERE "id" = ${persisted.id}
    `).catch(() => undefined);
    safeLog("error", "telegram.webhook.enqueue_failed", { requestId, updateId: update.update_id, updateRowId: persisted.id });
    return new Response(null, { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } });
  }

  return apiSuccess({ accepted: true, queued: true, recovered: persisted.duplicate }, requestId);
}
