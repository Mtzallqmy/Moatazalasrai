import { after } from "next/server";
import { getPostgresPool } from "@/db/pool";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import {
  telegramPlatformConfig,
  verifyTelegramWebhookSecret,
} from "@/lib/integrations/telegram-platform";
import { answerTelegramCallback } from "@/lib/telegram/message-renderer";
import { parseTelegramUpdate } from "@/lib/telegram/update-parser";
import { enqueueTelegramUpdateProcess } from "@/worker/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readPayload(request: Request) {
  const maxBytes = telegramPlatformConfig().webhookMaxBytes;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "حجم تحديث Telegram يتجاوز الحد المسموح.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "حجم تحديث Telegram يتجاوز الحد المسموح.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "صيغة تحديث Telegram غير صالحة.");
  }
}

async function persistUpdate(updateId: string, payload: Record<string, unknown>) {
  const inserted = await getPostgresPool().query<{ id: string; status: string }>(`
    INSERT INTO telegram_updates (
      integration_id,
      update_id,
      status,
      payload,
      received_at
    ) VALUES (NULL, $1, 'received', $2::jsonb, now())
    ON CONFLICT (update_id) WHERE integration_id IS NULL DO NOTHING
    RETURNING id, status
  `, [Number(updateId), JSON.stringify(payload)]);
  if (inserted.rows[0]) return { ...inserted.rows[0], duplicate: false as const };
  const existing = await getPostgresPool().query<{ id: string; status: string }>(`
    SELECT id, status
      FROM telegram_updates
     WHERE integration_id IS NULL
       AND update_id = $1
     LIMIT 1
  `, [Number(updateId)]);
  const row = existing.rows[0];
  if (!row) throw new Error("TELEGRAM_UPDATE_PERSIST_FAILED");
  return { ...row, duplicate: true as const };
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
      throw new ApiError(401, "TELEGRAM_WEBHOOK_UNAUTHORIZED", "تعذر التحقق من مصدر Telegram.");
    }
    const parsed = parseTelegramUpdate(await readPayload(request));
    console.info(JSON.stringify({
      level: "info",
      event: "telegram.webhook.received",
      requestId,
      updateId: parsed.updateId,
      kind: parsed.kind,
    }));

    const stored = await persistUpdate(parsed.updateId, parsed.raw);
    if (parsed.callbackId) {
      after(async () => {
        await answerTelegramCallback({ callbackId: parsed.callbackId! }).catch((error) => {
          console.warn(JSON.stringify({
            level: "warn",
            event: "telegram.callback.answer_failed",
            updateId: parsed.updateId,
            errorName: error instanceof Error ? error.name : "UnknownError",
          }));
        });
      });
    }

    if (stored.status !== "completed" && stored.status !== "ignored") {
      const queued = await enqueueTelegramUpdateProcess({ updateRowId: stored.id });
      await getPostgresPool().query(`
        UPDATE telegram_updates
           SET status = 'queued', queued_at = now()
         WHERE id = $1
           AND status <> 'completed'
      `, [stored.id]);
      return apiSuccess({ accepted: true, duplicate: stored.duplicate, jobId: queued.jobId }, requestId);
    }
    return apiSuccess({ accepted: true, duplicate: true, completed: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/webhooks/telegram");
  }
}
