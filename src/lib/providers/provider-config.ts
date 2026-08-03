import { decryptSecret } from "@/lib/security/encryption";
import { ProviderError, type ProviderCredentialMode, type ProviderKind, type ProviderTransportMode, type ProviderTypeId } from "@/lib/providers/types";

export type ProviderCredentialRuntimeConfig = {
  provider: ProviderKind;
  providerTypeId: string;
  transportMode: string;
  credentialMode: string;
  encryptedSecret: string | null;
  baseUrl: string;
  gatewayId: string | null;
  keyAlias: string | null;
};

export function defaultProviderTypeId(kind: ProviderKind): ProviderTypeId {
  if (kind === "openai") return "openai";
  if (kind === "anthropic") return "anthropic";
  if (kind === "gemini") return "google-ai-studio";
  return "custom-openai-compatible";
}

export function asProviderTypeId(value: string, fallbackKind: ProviderKind): ProviderTypeId {
  const allowed = new Set<ProviderTypeId>([
    "cloudflare-workers-ai",
    "cloudflare-ai-gateway",
    "openai",
    "anthropic",
    "google-ai-studio",
    "custom-openai-compatible",
  ]);
  return allowed.has(value as ProviderTypeId) ? value as ProviderTypeId : defaultProviderTypeId(fallbackKind);
}

export function asTransportMode(value: string): ProviderTransportMode {
  const allowed = new Set<ProviderTransportMode>([
    "direct",
    "cloudflare_ai_gateway_native",
    "cloudflare_ai_gateway_rest",
    "cloudflare_workers_ai",
  ]);
  if (!allowed.has(value as ProviderTransportMode)) {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", "نوع نقل المزود غير صالح.", 422, undefined, false, undefined, {
      category: "misconfigured",
      technicalMessage: `Unsupported transport mode: ${value}`,
    });
  }
  return value as ProviderTransportMode;
}

export function asCredentialMode(value: string): ProviderCredentialMode {
  const allowed = new Set<ProviderCredentialMode>(["encrypted_byok", "cloudflare_provider_key", "cloudflare_binding"]);
  if (!allowed.has(value as ProviderCredentialMode)) {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", "نوع مرجع بيانات الاعتماد غير صالح.", 422, undefined, false, undefined, {
      category: "misconfigured",
      technicalMessage: `Unsupported credential mode: ${value}`,
    });
  }
  return value as ProviderCredentialMode;
}

export function resolveProviderApiKey(config: ProviderCredentialRuntimeConfig, organizationId: string): string {
  const mode = asCredentialMode(config.credentialMode);
  if (mode === "encrypted_byok") {
    if (!config.encryptedSecret) {
      throw new ProviderError("PROVIDER_SECRET_REFERENCE_MISSING", "مفتاح المزود غير مهيأ.", 422, undefined, false, undefined, {
        category: "misconfigured",
        provider: asProviderTypeId(config.providerTypeId, config.provider),
      });
    }
    return decryptSecret(config.encryptedSecret, `provider:${organizationId}`);
  }
  if (mode === "cloudflare_provider_key") {
    if (!config.keyAlias) {
      throw new ProviderError("PROVIDER_SECRET_REFERENCE_MISSING", "مرجع Provider Key Alias غير مهيأ.", 422, undefined, false, undefined, {
        category: "misconfigured",
        provider: "cloudflare-ai-gateway",
      });
    }
    // The actual provider key remains in Cloudflare Secrets Store. The gateway transport removes this placeholder header.
    return "cloudflare-managed-provider-key";
  }
  return "cloudflare-binding";
}

export function validateCredentialTransport(input: {
  provider: ProviderKind;
  providerTypeId: ProviderTypeId;
  transportMode: ProviderTransportMode;
  credentialMode: ProviderCredentialMode;
  apiKey?: string;
  gatewayId?: string;
  keyAlias?: string;
}) {
  if (input.transportMode === "direct") {
    if (input.credentialMode !== "encrypted_byok" || !input.apiKey?.trim()) {
      throw new ProviderError("PROVIDER_SECRET_REFERENCE_MISSING", "المزوّد المباشر يتطلب مفتاح API مشفرًا.", 422, undefined, false, undefined, { category: "misconfigured" });
    }
    return;
  }
  if (input.transportMode === "cloudflare_ai_gateway_native") {
    if (!input.gatewayId?.trim()) throw new ProviderError("PROVIDER_CONFIG_INVALID", "Gateway ID مطلوب.", 422, undefined, false, undefined, { category: "misconfigured" });
    if (input.provider === "openai_compatible") throw new ProviderError("PROVIDER_CONFIG_INVALID", "المزوّد المخصص لا يدعم النقل الأصلي التلقائي عبر AI Gateway.", 422);
    if (input.credentialMode === "cloudflare_provider_key" && !input.keyAlias?.trim()) {
      throw new ProviderError("PROVIDER_SECRET_REFERENCE_MISSING", "Provider Key Alias مطلوب.", 422, undefined, false, undefined, { category: "misconfigured" });
    }
    if (input.credentialMode === "cloudflare_provider_key" && !cloudflareServerTokenConfigured()) {
      throw new ProviderError("PROVIDER_SECRET_REFERENCE_MISSING", "رمز تشغيل AI Gateway غير مهيأ على الخادم.", 422, undefined, false, undefined, { category: "misconfigured" });
    }
    if (input.credentialMode === "encrypted_byok" && !input.apiKey?.trim()) {
      throw new ProviderError("PROVIDER_SECRET_REFERENCE_MISSING", "أدخل مفتاح المزود أو اختر Provider Key Alias.", 422, undefined, false, undefined, { category: "misconfigured" });
    }
    return;
  }
  if (input.transportMode === "cloudflare_ai_gateway_rest") {
    if (input.credentialMode !== "cloudflare_binding" || !input.gatewayId?.trim()) {
      throw new ProviderError("PROVIDER_CONFIG_INVALID", "AI Gateway REST يتطلب Gateway ID ورمز Cloudflare مخزنًا كسر خادمي.", 422, undefined, false, undefined, { category: "misconfigured" });
    }
    if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
      throw new ProviderError("PROVIDER_SECRET_REFERENCE_MISSING", "CLOUDFLARE_API_TOKEN غير مهيأ على الخادم.", 422, undefined, false, undefined, { category: "misconfigured" });
    }
    return;
  }
  if (input.transportMode === "cloudflare_workers_ai") {
    if (input.providerTypeId !== "cloudflare-workers-ai" || input.credentialMode !== "cloudflare_binding") {
      throw new ProviderError("PROVIDER_CONFIG_INVALID", "Workers AI يتطلب AI binding ولا يقبل BYOK في هذا المسار.", 422, undefined, false, undefined, { category: "misconfigured" });
    }
  }
}

export function cloudflareServerTokenConfigured() {
  return Boolean(
    process.env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim()
    || process.env.CLOUDFLARE_API_TOKEN?.trim(),
  );
}
