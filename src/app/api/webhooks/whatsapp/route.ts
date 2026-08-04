import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappWebhookEvents } from "@/db/schema";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { processWhatsAppMessage } from "@/lib/integrations/whatsapp/commands";
import { secureStringEquals, verifyMetaWebhookSignature } from "@/lib/integrations/whatsapp/crypto";
import { extractWhatsAppMessages, type WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import { hydrateRuntimeForRequest } from "@/lib/platform/runtime-hydration";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

function databaseCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

async function processAcceptedEvent(eventId: string, message: WhatsAppIncomingMessage) {
  try {
    if (message.type !== "text" && message.type !== "interactive") {
      await db().update(whatsappWebhookEvents).set({
        status: "ignored",
        completedAt: new Date(),
      }).where(eq(whatsappWebhookEvents.id, eventId));
      return;
    }
    await processWhatsAppMessage(message);
    await db().update(whatsappWebhookEvents).set({
      status: "completed",
      completedAt: new Date(),
    }).where(eq(whatsappWebhookEvents.id, eventId));
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Z0-9_:-]{1,120}$/.test(error.message)
      ? error.message
      : error instanceof Error
        ? error.name.slice(0, 120)
        : "WHATSAPP_PROCESSING_FAILED";
    await db().update(whatsappWebhookEvents).set({
      status: "failed",
      errorCode,
      completedAt: new Date(),
    }).where(eq(whatsappWebhookEvents.id, eventId));
    console.error(JSON.stringify({
      level: "error",
      event: "whatsapp.webhook.processing_failed",
      eventId,
      errorCode,
    }));
  }
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
    try { payload = JSON.parse(rawBody); } catch {
      return apiFailure(400, "INVALID_JSON", "صيغة Webhook غير صالحة.", requestId);
    }
    const extracted = extractWhatsAppMessages(payload);
    const phoneNumberKey = extracted.find((item) => item.phoneNumberId)?.phoneNumberId ?? config.phoneNumberId;
    await enforceRateLimit({
      scope: "whatsapp.webhook.phone",
      key: phoneNumberKey,
      limit: 3_000,
      windowMs: 60_000,
    });

    const accepted: Array<{ eventId: string; message: WhatsAppIncomingMessage }> = [];
    let duplicates = 0;
    for (const item of extracted) {
      if (item.phoneNumberId && item.phoneNumberId !== config.phoneNumberId) continue;
      try {
        const [event] = await db().insert(whatsappWebhookEvents).values({
          messageId: item.message.id,
          phoneNumberId: item.phoneNumberId ?? config.phoneNumberId,
          eventType: item.message.type,
        }).returning({ id: whatsappWebhookEvents.id });
        if (event) accepted.push({ eventId: event.id, message: item.message });
      } catch (error) {
        if (databaseCode(error) === "23505") {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    if (accepted.length > 0) {
      after(async () => {
        await Promise.allSettled(accepted.map((item) => processAcceptedEvent(item.eventId, item.message)));
      });
    }
    return apiSuccess({ accepted: true, messages: accepted.length, duplicates }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/webhooks/whatsapp");
  }
}
