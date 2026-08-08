import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { runWithSystemDatabaseContext, runWithTenantDatabaseContext } from "@/db/tenant-context";
import { integrations, telegramUpdates } from "@/db/schema";
import { apiSuccess, getRequestId } from "@/lib/http/api";
import { secureHashEquals } from "@/lib/security/encryption";
import { enqueueTelegramUpdate } from "@/worker/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TELEGRAM_WEBHOOK_BYTES = 1024 * 1024;

type TelegramUpdate = {
  update_id?: number;
  message?: unknown;
  edited_message?: unknown;
  callback_query?: unknown;
};

export async function POST(request: Request, context: { params: Promise<{ integrationId: string }> }) {
  const requestId = getRequestId(request);
  const { integrationId } = await context.params;
  const integration = await runWithSystemDatabaseContext(async () => {
    const [row] = await db().select().from(integrations).where(and(
      eq(integrations.id, integrationId),
      eq(integrations.kind, "telegram"),
      eq(integrations.enabled, true),
      eq(integrations.status, "verified"),
    )).limit(1);
    return row ?? null;
  });
  if (!integration) return apiSuccess({ accepted: true, ignored: true }, requestId);

  const expectedHash = typeof integration.config.webhookSecretHash === "string"
    ? integration.config.webhookSecretHash
    : "";
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expectedHash || !suppliedSecret || !secureHashEquals(expectedHash, suppliedSecret)) {
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_TELEGRAM_WEBHOOK_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_TELEGRAM_WEBHOOK_BYTES) return new Response(null, { status: 413 });
  const update = (() => {
    try { return JSON.parse(raw) as TelegramUpdate; } catch { return null; }
  })();
  if (!update || !Number.isSafeInteger(update.update_id)) return apiSuccess({ accepted: false }, requestId);

  return runWithTenantDatabaseContext({ organizationId: integration.organizationId, userId: null }, async () => {
    let persisted: { id: string; status: string; errorCode: string | null; duplicate: boolean };
    try {
      const [inserted] = await db().insert(telegramUpdates).values({
        integrationId: integration.id,
        updateId: String(update.update_id),
      }).onConflictDoNothing().returning({
        id: telegramUpdates.id,
        status: telegramUpdates.status,
        errorCode: telegramUpdates.errorCode,
      });
      if (inserted) {
        persisted = { ...inserted, duplicate: false };
      } else {
        const [existing] = await db().select({
          id: telegramUpdates.id,
          status: telegramUpdates.status,
          errorCode: telegramUpdates.errorCode,
        }).from(telegramUpdates).where(and(
          eq(telegramUpdates.integrationId, integration.id),
          eq(telegramUpdates.updateId, String(update.update_id)),
        )).limit(1);
        if (!existing) throw new Error("TELEGRAM_UPDATE_PERSISTENCE_INCONSISTENT");
        persisted = { ...existing, duplicate: true };
      }
    } catch {
      console.error(JSON.stringify({
        level: "error",
        event: "telegram.channel_webhook.persist_failed",
        integrationId: integration.id,
        organizationId: integration.organizationId,
        requestId,
      }));
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
        updateId: update.update_id as number,
        update: update as Record<string, unknown>,
        integrationId: integration.id,
        organizationId: integration.organizationId,
      });
      await db().update(telegramUpdates).set({
        status: "accepted",
        errorCode: null,
        completedAt: null,
      }).where(eq(telegramUpdates.id, persisted.id));
    } catch (error) {
      await db().update(telegramUpdates).set({
        status: "accepted",
        errorCode: "TELEGRAM_QUEUE_UNAVAILABLE",
        completedAt: null,
      }).where(eq(telegramUpdates.id, persisted.id)).catch(() => undefined);
      console.error(JSON.stringify({
        level: "error",
        event: "telegram.channel_webhook.enqueue_failed",
        integrationId: integration.id,
        organizationId: integration.organizationId,
        updateId: update.update_id,
        requestId,
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
      }));
      return new Response(null, { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } });
    }

    return apiSuccess({ accepted: true, queued: true, recovered: persisted.duplicate }, requestId);
  });
}
