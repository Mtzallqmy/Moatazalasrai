// WhatsApp webhook verifies Meta signatures, preserves account-link commands, and delegates channel traffic.
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappWebhookEvents } from "@/db/schema";
import { channelConnectionForWebhook } from "@/lib/channels/connections";
import { whatsappChannelAdapter } from "@/lib/channels/whatsapp-adapter";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import { isFeatureEnabled } from "@/lib/control-plane/features";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { parseWhatsAppCommand, processWhatsAppMessage } from "@/lib/integrations/whatsapp/commands";
import { secureStringEquals, verifyMetaWebhookSignature } from "@/lib/integrations/whatsapp/crypto";
import { extractWhatsAppMessages, type WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import { hydrateRuntimeForRequest } from "@/lib/platform/runtime-hydration";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

function databaseCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

async function processLegacyEvent(eventId: string, message: WhatsAppIncomingMessage) {
  try {
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
      event: "whatsapp.webhook.legacy_processing_failed",
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
    const normalized = whatsappChannelAdapter.normalizeIncoming(payload, { externalAccountId: config.phoneNumberId });
    const phoneNumberKey = normalized.find((item) => item.externalAccountId)?.externalAccountId ?? config.phoneNumberId;
    await enforceRateLimit({
      scope: "whatsapp.webhook.phone",
      key: phoneNumberKey,
      limit: 3_000,
      windowMs: 60_000,
    });

    const legacyTasks: Array<{ eventId: string; message: WhatsAppIncomingMessage }> = [];
    const channelTasks: Array<{
      connection: NonNullable<Awaited<ReturnType<typeof channelConnectionForWebhook>>>;
      incoming: (typeof normalized)[number];
    }> = [];
    let duplicates = 0;
    let unconfigured = 0;
    let featureDisabled = 0;

    for (const item of extracted) {
      const parsed = parseWhatsAppCommand(item.message);
      const legacyCommand = parsed.kind === "connect"
        || parsed.kind === "account"
        || parsed.kind === "open_chat"
        || parsed.kind === "disconnect";
      if (!legacyCommand) continue;
      try {
        const [event] = await db().insert(whatsappWebhookEvents).values({
          messageId: item.message.id,
          phoneNumberId: item.phoneNumberId ?? config.phoneNumberId,
          eventType: `legacy:${parsed.kind}`,
        }).returning({ id: whatsappWebhookEvents.id });
        if (event) legacyTasks.push({ eventId: event.id, message: item.message });
      } catch (error) {
        if (databaseCode(error) === "23505") duplicates += 1;
        else throw error;
      }
    }

    const legacyIds = new Set(legacyTasks.map((task) => task.message.id));
    for (const incoming of normalized) {
      if (legacyIds.has(incoming.eventId)) continue;
      const connection = await channelConnectionForWebhook({
        kind: "whatsapp",
        externalAccountId: incoming.externalAccountId || config.phoneNumberId,
      });
      if (!connection) {
        unconfigured += 1;
        continue;
      }
      const enabled = await isFeatureEnabled(
        connection.organizationId,
        "whatsapp_integration",
        incoming.senderExternalId,
      );
      if (!enabled) {
        featureDisabled += 1;
        continue;
      }
      channelTasks.push({ connection, incoming });
    }

    if (legacyTasks.length > 0 || channelTasks.length > 0) {
      after(async () => {
        await Promise.allSettled([
          ...legacyTasks.map((task) => processLegacyEvent(task.eventId, task.message)),
          ...channelTasks.map((task) => routeIncomingChannelMessage(task)),
        ]);
      });
    }
    return apiSuccess({
      accepted: true,
      messages: legacyTasks.length + channelTasks.length,
      legacyCommands: legacyTasks.length,
      channelMessages: channelTasks.length,
      duplicates,
      unconfigured,
      featureDisabled,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/webhooks/whatsapp");
  }
}
