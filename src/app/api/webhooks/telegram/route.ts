import { sql } from "drizzle-orm";
import { db } from "@/db";
import { apiFailure, apiSuccess, getRequestId } from "@/lib/http/api";
import { answerTelegramCallback } from "@/lib/integrations/telegram";
import { telegramPlatformConfig, verifyTelegramWebhookSecret } from "@/lib/integrations/telegram-platform";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enqueueTelegramCentralUpdate } from "@/worker/queue";
import type { CentralTelegramUpdate } from "@/lib/telegram/update-processor";

export const runtime = "nodejs";

type PersistedUpdateRow = { id: string; status: string };

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown>) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

function firstPersistedRow(result: { rows: Record<string, unknown>[] }) {
  const row = result.rows[0];
  if (!row || typeof row.id !== "string" || typeof row.status !== "string") return null;
  return { id: row.id, status: row.status } satisfies PersistedUpdateRow;
}

async function centralUpdateRow(updateId: string) {
  const inserted = await db().execute(sql`
    INSERT INTO "telegram_updates" ("integration_id", "update_id", "status")
    VALUES (NULL, ${updateId}, 'accepted')
    ON CONFLICT DO NOTHING
    RETURNING "id", "status"
  `);
  const created = firstPersistedRow(inserted);
  if (created) return { ...created, duplicate: false };
  const existing = await db().execute(sql`
    SELECT "id", "status"
    FROM "telegram_updates"
    WHERE "integration_id" IS NULL AND "update_id" = ${updateId}
    LIMIT 1
  `);
  const row = firstPersistedRow(existing);
  return row ? { ...row, duplicate: true } : null;
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const config = telegramPlatformConfig();
  if (!config.enabled || !config.botToken || !config.webhookSecret) {
    return apiFailure(503, "TELEGRAM_DISABLED", "خدمة Telegram غير مفعلة.", requestId);
  }
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return apiFailure(401, "TELEGRAM_WEBHOOK_UNAUTHORIZED", "تعذر التحقق من Webhook.", requestId);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > config.webhookMaxBytes) {
    return apiFailure(413, "PAYLOAD_TOO_LARGE", "حجم Webhook أكبر من الحد المسموح.", requestId);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > config.webhookMaxBytes) {
    return apiFailure(413, "PAYLOAD_TOO_LARGE", "حجم Webhook أكبر من الحد المسموح.", requestId);
  }

  let update: CentralTelegramUpdate;
  try {
    update = JSON.parse(raw) as CentralTelegramUpdate;
  } catch {
    return apiFailure(400, "TELEGRAM_UPDATE_INVALID", "صيغة Telegram update غير صالحة.", requestId);
  }
  if (!Number.isSafeInteger(update.update_id)) {
    return apiFailure(400, "TELEGRAM_UPDATE_ID_REQUIRED", "Telegram update_id غير صالح.", requestId);
  }

  const updateId = String(update.update_id);
  await enforceRateLimit({ scope: "telegram.webhook.update", key: updateId, limit: 3, windowMs: 60_000 });
  safeLog("info", "telegram.webhook.received", {
    requestId,
    updateId,
    updateType: update.callback_query ? "callback_query" : update.edited_message ? "edited_message" : update.message ? "message" : "other",
  });

  if (update.callback_query?.id) {
    await answerTelegramCallback({
      token: config.botToken,
      callbackQueryId: update.callback_query.id,
    }).catch((error) => {
      safeLog("warn", "telegram.callback.answer_failed", {
        requestId,
        updateId,
        errorCode: error instanceof Error ? error.name : "TELEGRAM_CALLBACK_ANSWER_FAILED",
      });
    });
  }

  const row = await centralUpdateRow(updateId);
  if (!row) return apiFailure(503, "TELEGRAM_UPDATE_PERSIST_FAILED", "تعذر حفظ تحديث Telegram.", requestId);
  if (row.duplicate && row.status === "completed") {
    return apiSuccess({ accepted: true, duplicate: true }, requestId);
  }

  try {
    await enqueueTelegramCentralUpdate({
      updateRowId: row.id,
      update: update as unknown as Record<string, unknown>,
    });
  } catch (error) {
    await db().execute(sql`
      UPDATE "telegram_updates"
      SET "status" = 'failed', "error_code" = 'TELEGRAM_QUEUE_UNAVAILABLE', "completed_at" = now()
      WHERE "id" = ${row.id}
    `);
    safeLog("error", "telegram.update.enqueue_failed", {
      requestId,
      updateId,
      updateRowId: row.id,
      errorCode: error instanceof Error ? error.name : "TELEGRAM_QUEUE_UNAVAILABLE",
    });
    return apiFailure(503, "TELEGRAM_QUEUE_UNAVAILABLE", "تعذر جدولة تحديث Telegram.", requestId);
  }

  return apiSuccess({ accepted: true, duplicate: row.duplicate, queued: true }, requestId);
}
