// Thin WhatsApp ingress: verify, deduplicate, persist, acknowledge, then process asynchronously.
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappWebhookEvents } from "@/db/schema";
import { routeIncomingChannelMessage } from "@/lib/channels/router";
import {
  applyWhatsAppSessionSelection,
  channelPolicyForWhatsApp,
  connectionForWhatsAppPolicy,
  ensureOrganizationWhatsAppProjection,
  resolveEffectiveWhatsAppPolicy,
  withWhatsAppChannelPolicy,
} from "@/lib/channels/whatsapp-platform";
import { whatsappChannelAdapter } from "@/lib/channels/whatsapp-adapter";
import type { ChannelIncomingMessage } from "@/lib/channels/types";
import { isFeatureEnabled } from "@/lib/control-plane/features";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { secureStringEquals, verifyMetaWebhookSignature } from "@/lib/integrations/whatsapp/crypto";
import { extractWhatsAppMessages, type WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import { hydrateRuntimeForRequest } from "@/lib/platform/runtime-hydration";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { whatsappErrorPresentation } from "@/lib/whatsapp/error-presenter";
import { sendWhatsAppError } from "@/lib/whatsapp/message-renderer";
import { sessionState, updateWhatsAppSession } from "@/lib/whatsapp/session-service";
import { processWhatsAppUpdate } from "@/lib/whatsapp/update-processor";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

function databaseCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

async function markEvent(eventId: string, status: string, errorCode?: string) {
  await db().update(whatsappWebhookEvents).set({
    status,
    errorCode: errorCode ?? null,
    completedAt: new Date(),
  }).where(eq(whatsappWebhookEvents.id, eventId));
}

function newConversationCommand(incoming: ChannelIncomingMessage): ChannelIncomingMessage {
  return {
    ...incoming,
    eventId: `${incoming.eventId}:new`,
    text: "new",
    messageType: "text",
    interactiveActionId: undefined,
    attachments: [],
  };
}

async function processAcceptedMessage(input: {
  eventId: string;
  message: WhatsAppIncomingMessage;
  incoming: ChannelIncomingMessage;
  requestId: string;
}) {
  try {
    const processed = await processWhatsAppUpdate({
      message: input.message,
      requestId: input.requestId,
    });
    if (processed.handled) {
      await markEvent(input.eventId, "completed");
      return;
    }
    if (!processed.context) {
      await markEvent(input.eventId, "ignored", "WHATSAPP_CONTEXT_MISSING");
      return;
    }

    let policy = await resolveEffectiveWhatsAppPolicy({
      organizationId: processed.context.identity.organizationId,
      userId: processed.context.identity.userId,
    });
    policy = await applyWhatsAppSessionSelection(policy, processed.context.session);
    if (policy.status === "disabled" || !policy.autoReplyEnabled) {
      await sendWhatsAppError({
        to: input.message.from,
        text: "الرد الآلي على WhatsApp معطل وفق السياسة الحالية.",
      });
      await markEvent(input.eventId, "ignored", "WHATSAPP_POLICY_DISABLED");
      return;
    }

    const baseConnection = await ensureOrganizationWhatsAppProjection(processed.context.identity.organizationId);
    const connection = connectionForWhatsAppPolicy(baseConnection, policy);
    const enabled = await isFeatureEnabled(
      connection.organizationId,
      "whatsapp_integration",
      input.incoming.senderExternalId,
    );
    if (!enabled) {
      await sendWhatsAppError({
        to: input.message.from,
        text: "تكامل WhatsApp معطل في المؤسسة.",
      });
      await markEvent(input.eventId, "ignored", "WHATSAPP_MODULE_DISABLED");
      return;
    }

    const routingPolicy = channelPolicyForWhatsApp(connection.id, policy);
    const route = (incoming: ChannelIncomingMessage) => withWhatsAppChannelPolicy({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      routingPolicy,
    }, () => routeIncomingChannelMessage({ connection, incoming }));

    const state = sessionState(processed.context.session);
    if (state.forceNewConversation === true) {
      const created = await route(newConversationCommand(input.incoming));
      processed.context.session = await updateWhatsAppSession({
        session: processed.context.session,
        selectedConversationId: created.conversationId ?? null,
        state: { ...state, forceNewConversation: false },
      });
    }

    const result = await route(input.incoming);
    if (result.conversationId && result.conversationId !== processed.context.session.selectedConversationId) {
      processed.context.session = await updateWhatsAppSession({
        session: processed.context.session,
        selectedConversationId: result.conversationId,
        state: { ...sessionState(processed.context.session), forceNewConversation: false },
      });
    }
    await markEvent(input.eventId, result.ignored ? "ignored" : "completed");
  } catch (error) {
    const presentation = whatsappErrorPresentation(error);
    await sendWhatsAppError({
      to: input.message.from,
      text: presentation.message,
      referenceId: presentation.expected ? undefined : presentation.referenceId,
    }).catch(() => undefined);
    await markEvent(input.eventId, "failed", presentation.code);
    console.error(JSON.stringify({
      level: "error",
      event: "whatsapp.update.processing_failed",
      eventId: input.eventId,
      errorCode: presentation.code,
      referenceId: presentation.referenceId,
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
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiFailure(400, "INVALID_JSON", "صيغة Webhook غير صالحة.", requestId);
    }

    const extracted = extractWhatsAppMessages(payload);
    const normalized = whatsappChannelAdapter.normalizeIncoming(payload, {
      externalAccountId: config.phoneNumberId,
    });
    const normalizedById = new Map(normalized.map((incoming) => [incoming.eventId, incoming]));
    const phoneNumberKey = normalized.find((item) => item.externalAccountId)?.externalAccountId
      ?? config.phoneNumberId;
    await enforceRateLimit({
      scope: "whatsapp.webhook.phone",
      key: phoneNumberKey,
      limit: 3_000,
      windowMs: 60_000,
    });

    const tasks: Array<{
      eventId: string;
      message: WhatsAppIncomingMessage;
      incoming: ChannelIncomingMessage;
    }> = [];
    let duplicates = 0;
    for (const item of extracted) {
      const incoming = normalizedById.get(item.message.id);
      if (!incoming) continue;
      try {
        const [event] = await db().insert(whatsappWebhookEvents).values({
          messageId: item.message.id,
          phoneNumberId: item.phoneNumberId ?? config.phoneNumberId,
          eventType: item.message.type || "unknown",
          status: "accepted",
        }).returning({ id: whatsappWebhookEvents.id });
        if (event) tasks.push({ eventId: event.id, message: item.message, incoming });
      } catch (error) {
        if (databaseCode(error) === "23505") duplicates += 1;
        else throw error;
      }
    }

    if (tasks.length) {
      after(async () => {
        await Promise.allSettled(tasks.map((task) => processAcceptedMessage({ ...task, requestId })));
      });
    }

    return apiSuccess({
      accepted: true,
      messages: tasks.length,
      duplicates,
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/webhooks/whatsapp");
  }
}
