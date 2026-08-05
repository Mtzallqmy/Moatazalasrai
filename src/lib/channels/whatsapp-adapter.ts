// WhatsApp Cloud API implementation of the shared channel adapter contract.
import { ApiError } from "@/lib/http/api";
import {
  downloadWhatsAppMedia,
  markMessageAsRead,
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextMessage,
  testWhatsAppPhoneNumber,
  WhatsAppApiError,
} from "@/lib/integrations/whatsapp/client";
import { requireWhatsAppConfig, type WhatsAppRuntimeConfig } from "@/lib/integrations/whatsapp/config";
import { extractWhatsAppMessages, type WhatsAppIncomingMessage } from "@/lib/integrations/whatsapp/webhook";
import type {
  ChannelAdapter,
  ChannelAdapterContext,
  ChannelIncomingAttachment,
} from "./types";

function runtimeConfig(context: ChannelAdapterContext): WhatsAppRuntimeConfig {
  if (context.credentials.kind !== "whatsapp") throw new Error("WHATSAPP_CREDENTIALS_REQUIRED");
  const configured = requireWhatsAppConfig();
  return {
    ...configured,
    accessToken: context.credentials.accessToken,
    phoneNumberId: context.credentials.phoneNumberId,
    graphApiVersion: context.credentials.graphApiVersion,
  };
}

function media(message: WhatsAppIncomingMessage): ChannelIncomingAttachment[] {
  const output: ChannelIncomingAttachment[] = [];
  if (message.image?.id) {
    output.push({
      externalId: message.image.id,
      kind: "image",
      filename: `whatsapp-${message.id}.jpg`,
      mimeType: message.image.mime_type,
    });
  }
  if (message.document?.id) {
    output.push({
      externalId: message.document.id,
      kind: "file",
      filename: message.document.filename ?? `whatsapp-${message.id}`,
      mimeType: message.document.mime_type,
    });
  }
  if (message.audio?.id) {
    output.push({
      externalId: message.audio.id,
      kind: "audio",
      filename: `whatsapp-${message.id}.ogg`,
      mimeType: message.audio.mime_type,
    });
  }
  if (message.video?.id) {
    output.push({
      externalId: message.video.id,
      kind: "video",
      filename: `whatsapp-${message.id}.mp4`,
      mimeType: message.video.mime_type,
    });
  }
  return output;
}

function messageText(message: WhatsAppIncomingMessage) {
  return (
    message.text?.body
    ?? message.interactive?.button_reply?.title
    ?? message.interactive?.list_reply?.title
    ?? message.image?.caption
    ?? message.document?.caption
    ?? message.video?.caption
    ?? ""
  ).trim();
}

function actionId(message: WhatsAppIncomingMessage) {
  return message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
}

export const whatsappChannelAdapter: ChannelAdapter = {
  kind: "whatsapp",
  capabilities: new Set(["text", "images", "files", "audio", "video", "interactive", "read_receipts", "reply"]),
  normalizeIncoming(payload, hints) {
    return extractWhatsAppMessages(payload).map((item) => {
      const attachments = media(item.message);
      const interactiveActionId = actionId(item.message);
      return {
        eventId: item.message.id,
        externalAccountId: item.phoneNumberId ?? hints?.externalAccountId ?? "",
        conversationExternalId: item.message.from,
        senderExternalId: item.message.from,
        senderDisplayName: item.senderDisplayName,
        text: messageText(item.message),
        messageType: attachments.length ? "media" : interactiveActionId ? "interactive" : item.message.type === "text" ? "text" : "unknown",
        interactiveActionId,
        replyToExternalId: item.message.context?.id,
        attachments,
        receivedAt: item.message.timestamp && /^\d+$/.test(item.message.timestamp)
          ? new Date(Number(item.message.timestamp) * 1000)
          : new Date(),
      };
    });
  },
  async send(context, message) {
    const config = runtimeConfig(context);
    if (message.list?.actions.length) {
      const sent = await sendInteractiveList({
        to: message.to,
        bodyText: message.text,
        buttonText: message.list.buttonText,
        title: message.list.title,
        actions: message.list.actions,
        config,
      });
      return { externalMessageId: sent.messageId };
    }
    if (message.buttons?.length) {
      const sent = await sendInteractiveButtons({
        to: message.to,
        bodyText: message.text,
        buttons: message.buttons,
        config,
      });
      return { externalMessageId: sent.messageId };
    }
    const sent = await sendTextMessage({
      to: message.to,
      text: message.text,
      replyToMessageId: message.replyToExternalId,
      config,
    });
    return { externalMessageId: sent.messageId };
  },
  async markRead(context, externalMessageId) {
    await markMessageAsRead({ messageId: externalMessageId, config: runtimeConfig(context) });
  },
  async downloadAttachment(context, attachment) {
    return downloadWhatsAppMedia({
      mediaId: attachment.externalId,
      filename: attachment.filename,
      config: runtimeConfig(context),
    });
  },
  async test(context) {
    const started = performance.now();
    try {
      const phone = await testWhatsAppPhoneNumber({ config: runtimeConfig(context) });
      if (phone.id !== context.externalAccountId) {
        throw new ApiError(422, "WHATSAPP_PHONE_NUMBER_ID_MISMATCH", "بيانات Meta تعود لرقم مختلف عن اتصال WhatsApp المحفوظ.");
      }
      return {
        status: phone.quality_rating === "RED" ? "degraded" as const : "healthy" as const,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        details: `${phone.verified_name ?? "WhatsApp Business"} — ${phone.display_phone_number ?? phone.id} — ${phone.quality_rating ?? "UNKNOWN"}`,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        details: error instanceof Error ? error.message : "تعذر الاتصال بـMeta Graph API.",
        errorCode: error instanceof WhatsAppApiError || error instanceof ApiError
          ? error.code
          : "WHATSAPP_API_ERROR",
      };
    }
  },
};
