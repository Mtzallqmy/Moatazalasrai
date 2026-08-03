import { ProviderError, type ProviderKind } from "@/lib/providers/types";

const GATEWAY_HOST = "gateway.ai.cloudflare.com";
const API_HOST = "api.cloudflare.com";
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,96}$/;

export type CloudflareGatewayProvider = "openai" | "anthropic" | "google-ai-studio";

export function assertCloudflareIdentifier(value: string, field: "accountId" | "gatewayId" | "keyAlias"): string {
  const normalized = value.trim();
  if (!IDENTIFIER.test(normalized)) {
    throw new ProviderError(
      "PROVIDER_CONFIG_INVALID",
      `قيمة ${field} غير صالحة لإعداد Cloudflare.`,
      400,
      undefined,
      false,
      undefined,
      { category: "misconfigured", technicalMessage: `Invalid Cloudflare ${field}` },
    );
  }
  return normalized;
}

export function cloudflareProviderSlug(provider: ProviderKind): CloudflareGatewayProvider {
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini") return "google-ai-studio";
  throw new ProviderError(
    "PROVIDER_CONFIG_INVALID",
    "المزوّد المتوافق المخصص لا يُوجّه تلقائيًا عبر Cloudflare AI Gateway.",
    422,
    undefined,
    false,
    undefined,
    { category: "misconfigured", provider },
  );
}

export function providerNativeGatewayBaseUrl(input: {
  accountId: string;
  gatewayId: string;
  provider: ProviderKind;
}) {
  const accountId = assertCloudflareIdentifier(input.accountId, "accountId");
  const gatewayId = assertCloudflareIdentifier(input.gatewayId, "gatewayId");
  const provider = cloudflareProviderSlug(input.provider);
  const base = `https://${GATEWAY_HOST}/v1/${accountId}/${gatewayId}/${provider}`;
  return input.provider === "gemini" ? `${base}/v1` : base;
}

export function aiGatewayRestBaseUrl(accountIdInput: string) {
  const accountId = assertCloudflareIdentifier(accountIdInput, "accountId");
  return `https://${API_HOST}/client/v4/accounts/${accountId}/ai/v1`;
}

export function gatewayControlHeaders(input: {
  gatewayToken?: string;
  keyAlias?: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
}) {
  const headers: Record<string, string> = {
    "cf-aig-skip-cache": String(input.skipCache ?? true),
    "cf-aig-collect-log": String(input.collectLog ?? false),
  };
  const token = input.gatewayToken?.trim();
  if (token) headers["cf-aig-authorization"] = `Bearer ${token}`;
  if (input.keyAlias?.trim()) {
    headers["cf-aig-byok-alias"] = assertCloudflareIdentifier(input.keyAlias, "keyAlias");
  }
  if (input.cacheTtl !== undefined) {
    if (!Number.isInteger(input.cacheTtl) || input.cacheTtl < 0 || input.cacheTtl > 31_536_000) {
      throw new ProviderError(
        "PROVIDER_CONFIG_INVALID",
        "قيمة cacheTtl خارج النطاق المسموح.",
        400,
        undefined,
        false,
        undefined,
        { category: "misconfigured", technicalMessage: "Invalid Cloudflare cacheTtl" },
      );
    }
    headers["cf-aig-cache-ttl"] = String(input.cacheTtl);
  }
  return headers;
}

export function restApiHeaders(input: {
  apiToken: string;
  gatewayId: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
}) {
  const token = input.apiToken.trim();
  if (!token) {
    throw new ProviderError(
      "PROVIDER_SECRET_REFERENCE_MISSING",
      "رمز Cloudflare المطلوب غير مهيأ على الخادم.",
      422,
      undefined,
      false,
      undefined,
      { category: "misconfigured", technicalMessage: "Cloudflare API token is missing" },
    );
  }
  return {
    authorization: `Bearer ${token}`,
    "cf-aig-gateway-id": assertCloudflareIdentifier(input.gatewayId, "gatewayId"),
    "content-type": "application/json",
    ...gatewayControlHeaders({
      skipCache: input.skipCache,
      cacheTtl: input.cacheTtl,
      collectLog: input.collectLog,
    }),
  };
}

export function isCloudflareGatewayUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === GATEWAY_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}
