import { afterEach, describe, expect, it } from "vitest";
import {
  aiGatewayRestBaseUrl,
  gatewayControlHeaders,
  providerNativeGatewayBaseUrl,
  restApiHeaders,
} from "@/lib/providers/cloudflare-endpoints";
import { healthStatusForProviderError, normalizeUnknownProviderError } from "@/lib/providers/errors";
import { validateCloudflareRestModel } from "@/lib/providers/cloudflare-rest";
import { providerErrorForHttpStatus } from "@/lib/providers/http";
import { validateCredentialTransport } from "@/lib/providers/provider-config";
import { ProviderError } from "@/lib/providers/types";

afterEach(() => {
  delete process.env.CLOUDFLARE_AI_GATEWAY_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;
});

describe("Cloudflare provider platform", () => {
  it("builds only current provider-native and REST endpoints", () => {
    expect(providerNativeGatewayBaseUrl({ accountId: "account", gatewayId: "gateway", provider: "openai" }))
      .toBe("https://gateway.ai.cloudflare.com/v1/account/gateway/openai");
    expect(providerNativeGatewayBaseUrl({ accountId: "account", gatewayId: "gateway", provider: "anthropic" }))
      .toBe("https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic");
    expect(providerNativeGatewayBaseUrl({ accountId: "account", gatewayId: "gateway", provider: "gemini" }))
      .toBe("https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio/v1");
    expect(aiGatewayRestBaseUrl("account")).toBe("https://api.cloudflare.com/client/v4/accounts/account/ai/v1");
    expect(JSON.stringify([
      providerNativeGatewayBaseUrl({ accountId: "account", gatewayId: "gateway", provider: "openai" }),
      aiGatewayRestBaseUrl("account"),
    ])).not.toContain("/compat");
  });

  it("constructs gateway headers without exposing provider secrets", () => {
    expect(gatewayControlHeaders({ gatewayToken: "cf-token", keyAlias: "production", skipCache: true, cacheTtl: 30, collectLog: false }))
      .toEqual({
        "cf-aig-authorization": "Bearer cf-token",
        "cf-aig-byok-alias": "production",
        "cf-aig-skip-cache": "true",
        "cf-aig-cache-ttl": "30",
        "cf-aig-collect-log": "false",
      });
    expect(restApiHeaders({ apiToken: "api-token", gatewayId: "gateway" }).authorization).toBe("Bearer api-token");
  });

  it.each([
    [401, "authentication", "unauthorized", false],
    [403, "authorization", "unauthorized", false],
    [404, "model_unavailable", "model_unavailable", false],
    [408, "timeout", "network_error", true],
    [429, "rate_limit", "rate_limited", true],
    [503, "provider_unavailable", "degraded", true],
  ] as const)("normalizes HTTP %s from actual evidence", (status, category, health, retryable) => {
    const error = normalizeUnknownProviderError(providerErrorForHttpStatus(status, "provider evidence"), {
      provider: "cloudflare-ai-gateway",
      model: "openai/test",
      requestId: "request-1",
    });
    expect(error.category).toBe(category);
    expect(healthStatusForProviderError(error)).toBe(health);
    expect(error.retryable).toBe(retryable);
    expect(error.diagnostic()).toMatchObject({ provider: "cloudflare-ai-gateway", model: "openai/test", requestId: "request-1" });
  });

  it("does not claim a key is invalid for an unproven network failure", () => {
    const error = normalizeUnknownProviderError(new Error("fetch failed: DNS lookup"));
    expect(error.category).toBe("network");
    expect(error.message).toContain("لا يمكن تأكيد صحة المفتاح");
  });

  it("redacts tokens from technical diagnostics", () => {
    const error = normalizeUnknownProviderError(new Error("Authorization=secret Bearer abc.def api_key=hidden"));
    expect(error.technicalMessage).not.toContain("secret");
    expect(error.technicalMessage).not.toContain("abc.def");
    expect(error.technicalMessage).not.toContain("hidden");
  });

  it("rejects provider-key aliases unless a gateway token exists", () => {
    expect(() => validateCredentialTransport({
      provider: "openai",
      providerTypeId: "cloudflare-ai-gateway",
      transportMode: "cloudflare_ai_gateway_native",
      credentialMode: "cloudflare_provider_key",
      gatewayId: "gateway",
      keyAlias: "production",
    })).toThrow("رمز تشغيل AI Gateway");
    process.env.CLOUDFLARE_AI_GATEWAY_TOKEN = "configured";
    expect(() => validateCredentialTransport({
      provider: "openai",
      providerTypeId: "cloudflare-ai-gateway",
      transportMode: "cloudflare_ai_gateway_native",
      credentialMode: "cloudflare_provider_key",
      gatewayId: "gateway",
      keyAlias: "production",
    })).not.toThrow();
  });

  it("validates that the REST model belongs to the selected provider", () => {
    expect(validateCloudflareRestModel("openai", "openai/gpt-4.1")).toBe("openai/gpt-4.1");
    expect(validateCloudflareRestModel("anthropic", "anthropic/claude-sonnet-4")).toBe("anthropic/claude-sonnet-4");
    expect(validateCloudflareRestModel("gemini", "google/gemini-3-flash")).toBe("google/gemini-3-flash");
    expect(validateCloudflareRestModel("gemini", "google-ai-studio/gemini-2.5-flash")).toBe("google-ai-studio/gemini-2.5-flash");
    expect(() => validateCloudflareRestModel("openai", "anthropic/claude-sonnet-4")).toThrow("لا يطابق المزود");
  });

  it("requires the Cloudflare API token for the new REST API", () => {
    expect(() => validateCredentialTransport({
      provider: "openai",
      providerTypeId: "cloudflare-ai-gateway",
      transportMode: "cloudflare_ai_gateway_rest",
      credentialMode: "cloudflare_binding",
      gatewayId: "gateway",
    })).toThrow("CLOUDFLARE_API_TOKEN");
  });

  it("keeps unknown causes unknown rather than healthy", () => {
    const error = normalizeUnknownProviderError(new ProviderError("UNCLASSIFIED", "تعذر تحديد السبب النهائي.", 502));
    expect(error.category).toBe("unknown");
    expect(healthStatusForProviderError(error)).toBe("unknown");
  });
});
