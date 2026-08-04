import { ApiError } from "@/lib/http/api";
import { env } from "@/lib/config/env";

export type WhatsAppRuntimeConfig = {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  webhookVerifyToken: string;
  connectTokenSecret: string;
  connectTokenTtlMinutes: number;
  publicAppUrl: string;
};

export function isWhatsAppIntegrationEnabled() {
  return process.env.WHATSAPP_INTEGRATION_ENABLED?.trim().toLowerCase() === "true";
}

export function requireWhatsAppConfig(): WhatsAppRuntimeConfig {
  const runtime = env();
  if (!runtime.whatsappIntegrationEnabled) {
    throw new ApiError(404, "WHATSAPP_INTEGRATION_DISABLED", "تكامل WhatsApp غير مفعّل.");
  }
  if (
    !runtime.metaAppId
    || !runtime.metaAppSecret
    || !runtime.metaGraphApiVersion
    || !runtime.whatsappAccessToken
    || !runtime.whatsappPhoneNumberId
    || !runtime.whatsappBusinessAccountId
    || !runtime.whatsappDisplayPhoneNumber
    || !runtime.whatsappWebhookVerifyToken
    || !runtime.whatsappConnectTokenSecret
    || !runtime.publicAppUrl
  ) {
    throw new ApiError(503, "WHATSAPP_CONFIG_INCOMPLETE", "إعدادات WhatsApp غير مكتملة على الخادم.");
  }
  return {
    appId: runtime.metaAppId,
    appSecret: runtime.metaAppSecret,
    graphApiVersion: runtime.metaGraphApiVersion,
    accessToken: runtime.whatsappAccessToken,
    phoneNumberId: runtime.whatsappPhoneNumberId,
    businessAccountId: runtime.whatsappBusinessAccountId,
    displayPhoneNumber: runtime.whatsappDisplayPhoneNumber,
    webhookVerifyToken: runtime.whatsappWebhookVerifyToken,
    connectTokenSecret: runtime.whatsappConnectTokenSecret,
    connectTokenTtlMinutes: runtime.whatsappConnectTokenTtlMinutes,
    publicAppUrl: runtime.publicAppUrl,
  };
}
