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
  if (Number.isFinite(contentLength) && contentLength > MAX_TELEGRAM_WEBHOOK_BYTES) {
    return new Response(null, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_TELEGRAM_WEBHOOK_BYTES) {
    return new Response(null, { status: 413 });
  }
  const update = (() => {
    try {
      return JSON.parse(raw) as TelegramUpdate;
    } catch {
      return null;
    }
  })();
  if (!update || !Number.isSafeInteger(update.update_id)) return apiSuccess({ accepted: false }, requestId);

  return runWithTenantDatabaseContext({
    organizationId: integration.organizationId,
    userId: null,
  }, async () => {
    let updateRowId: string;
    try {
      const [updateRow] = await db().insert(telegramUpdates).values({
        integrationId: integration.id,
        updateId: String(update.update_id),
      }).returning({ id: telegramUpdates.id });
      if (!updateRow) throw new Error("TELEGRAM_UPDATE_INSERT_FAILED");
      updateRowId = updateRow.id;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "23505") return apiSuccess({ accepted: true, duplicate: true }, requestId);
      console.error(JSON.stringify({
        level: "error",
        event: "telegram.channel_webhook.persist_failed",
        integrationId: integration.id,
        organizationId: integration.organizationId,
        requestId,
      }));
      return new Response(null, { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } });
    }

    try {
      await enqueueTelegramUpdate({
        updateRowId,
        updateId: update.update_id as number,
        update: update as Record<string, unknown>,
        integrationId: integration.id,
        organizationId: integration.organizationId,
      });
    } catch (error) {
      await db().update(telegramUpdates).set({
        status: "failed",
        errorCode: "TELEGRAM_QUEUE_UNAVAILABLE",
        completedAt: new Date(),
      }).where(eq(telegramUpdates.id, updateRowId)).catch(() => undefined);
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

    return apiSuccess({ accepted: true, queued: true }, requestId);
  });
}
