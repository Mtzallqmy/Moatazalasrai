// WhatsApp runtime configuration treats a complete Railway environment as enabled.
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

function complete(runtime: ReturnType<typeof env>) {
  return Boolean(
    runtime.metaAppId
    && runtime.metaAppSecret
    && runtime.metaGraphApiVersion
    && runtime.whatsappAccessToken
    && runtime.whatsappPhoneNumberId
    && runtime.whatsappBusinessAccountId
    && runtime.whatsappDisplayPhoneNumber
    && runtime.whatsappWebhookVerifyToken
    && runtime.whatsappConnectTokenSecret
    && runtime.publicAppUrl
  );
}

export function isWhatsAppIntegrationEnabled() {
  try {
    const runtime = env();
    return runtime.whatsappIntegrationEnabled || complete(runtime);
  } catch {
    return false;
  }
}

export function requireWhatsAppConfig(): WhatsAppRuntimeConfig {
  const runtime = env();
  if (!complete(runtime)) {
    throw new ApiError(503, "WHATSAPP_CONFIG_INCOMPLETE", "إعدادات WhatsApp غير مكتملة داخل بيئة تشغيل الخادم.");
  }
  return {
    appId: runtime.metaAppId!,
    appSecret: runtime.metaAppSecret!,
    graphApiVersion: runtime.metaGraphApiVersion!,
    accessToken: runtime.whatsappAccessToken!,
    phoneNumberId: runtime.whatsappPhoneNumberId!,
    businessAccountId: runtime.whatsappBusinessAccountId!,
    displayPhoneNumber: runtime.whatsappDisplayPhoneNumber!,
    webhookVerifyToken: runtime.whatsappWebhookVerifyToken!,
    connectTokenSecret: runtime.whatsappConnectTokenSecret!,
    connectTokenTtlMinutes: runtime.whatsappConnectTokenTtlMinutes,
    publicAppUrl: runtime.publicAppUrl!,
  };
}
