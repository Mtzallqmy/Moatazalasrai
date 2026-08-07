// WhatsApp webhook verifies Meta signatures, persists each message, and returns before heavy processing.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappWebhookEvents } from "@/db/schema";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { secureStringEquals, verifyMetaWebhookSignature } from "@/lib/integrations/whatsapp/crypto";
import { extractWhatsAppMessages } from "@/lib/integrations/whatsapp/webhook";
import { hydrateRuntimeForRequest } from "@/lib/platform/runtime-hydration";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enqueueWhatsAppChannelUpdate } from "@/worker/queue";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

function safeLog(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown>) {
  console[level](JSON.stringify({ level, event, ...metadata }));
}

async function eventRow(input: {
  messageId: string;
  phoneNumberId: string;
  eventType: string;
}) {
  const [created] = await db().insert(whatsappWebhookEvents).values({
    messageId: input.messageId,
    phoneNumberId: input.phoneNumberId,
    eventType: input.eventType,
    status: "accepted",
  }).onConflictDoNothing().returning({
    id: whatsappWebhookEvents.id,
    status: whatsappWebhookEvents.status,
  });
  if (created) return { ...created, duplicate: false };
  const [existing] = await db().select({
    id: whatsappWebhookEvents.id,
    status: whatsappWebhookEvents.status,
  }).from(whatsappWebhookEvents).where(and(
    eq(whatsappWebhookEvents.messageId, input.messageId),
  )).limit(1);
  return existing ? { ...existing, duplicate: true } : null;
}

export async function GET(request: Request) {
  let config: ReturnType<typeof requireWhatsAppConfig>;
  try {
    await hydrateRuntimeForRequest();
    config = requireWhatsAppConfig();
  } catch {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const verifyToken = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !challenge || !secureStringEquals(config.webhookVerifyToken, verifyToken)) {
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    await hydrateRuntimeForRequest();
    const config = requireWhatsAppConfig();
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
      return apiFailure(413, "PAYLOAD_TOO_LARGE", "حجم Webhook أكبر من الحد المسموح.", requestId);
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
      return apiFailure(413, "PAYLOAD_TOO_LARGE", "حجم Webhook أكبر من الحد المسموح.", requestId);
    }
    if (!verifyMetaWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), config.appSecret)) {
      return apiFailure(401, "WHATSAPP_SIGNATURE_INVALID", "تعذر التحقق من توقيع Webhook.", requestId);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiFailure(400, "INVALID_JSON", "صيغة Webhook غير صالحة.", requestId);
    }

    const extracted = extractWhatsAppMessages(payload);
    await enforceRateLimit({
      scope: "whatsapp.webhook.phone",
      key: config.phoneNumberId,
      limit: 3_000,
      windowMs: 60_000,
    });

    let queued = 0;
    let duplicates = 0;
    let failed = 0;
    for (const item of extracted) {
      const row = await eventRow({
        messageId: item.message.id,
        phoneNumberId: item.phoneNumberId ?? config.phoneNumberId,
        eventType: item.message.type,
      });
      if (!row) {
        failed += 1;
        continue;
      }
      if (row.duplicate && row.status === "completed") {
        duplicates += 1;
        continue;
      }
      try {
        await enqueueWhatsAppChannelUpdate({
          eventRowId: row.id,
          message: item.message as unknown as Record<string, unknown>,
        });
        queued += 1;
      } catch (error) {
        failed += 1;
        await db().update(whatsappWebhookEvents).set({
          status: "failed",
          errorCode: "WHATSAPP_QUEUE_UNAVAILABLE",
          completedAt: new Date(),
        }).where(eq(whatsappWebhookEvents.id, row.id));
        safeLog("error", "whatsapp.update.enqueue_failed", {
          requestId,
          messageId: item.message.id,
          eventRowId: row.id,
          errorCode: error instanceof Error ? error.name : "WHATSAPP_QUEUE_UNAVAILABLE",
        });
      }
    }

    if (failed > 0 && queued === 0 && extracted.length > 0) {
      return apiFailure(503, "WHATSAPP_QUEUE_UNAVAILABLE", "تعذر جدولة رسائل WhatsApp.", requestId);
    }
    return apiSuccess({ accepted: true, messages: extracted.length, queued, duplicates, failed }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/webhooks/whatsapp");
  }
}
