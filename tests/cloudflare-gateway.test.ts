import { afterEach, describe, expect, it } from "vitest";
import { resolveCloudflareGateway } from "@/lib/providers/cloudflare-gateway";

afterEach(() => {
  for (const key of ["CLOUDFLARE_AI_GATEWAY_ENABLED", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_GATEWAY_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_GATEWAY_BASE_URL"]) delete process.env[key];
});

describe("optional Cloudflare AI Gateway routing", () => {
  it("keeps direct BYOK routing as the default", () => {
    expect(resolveCloudflareGateway({ provider: "openai", directBaseUrl: "https://api.openai.com/v1/" })).toEqual({ baseUrl: "https://api.openai.com/v1", headers: {}, gateway: false });
  });

  it("routes explicitly enabled providers without caching or payload logs", () => {
    process.env.CLOUDFLARE_AI_GATEWAY_ENABLED = "true";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
    process.env.CLOUDFLARE_AI_GATEWAY_ID = "gateway-id";
    process.env.CLOUDFLARE_API_TOKEN = "cloudflare-platform-token";
    const resolved = resolveCloudflareGateway({ provider: "anthropic", directBaseUrl: "https://api.anthropic.com", organizationId: "tenant-secret-id", requestId: "request-1" });
    expect(resolved.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/anthropic");
    expect(resolved.headers["cf-aig-skip-cache"]).toBe("true");
    expect(resolved.headers["cf-aig-collect-log-payload"]).toBe("false");
    expect(resolved.headers["cf-aig-max-attempts"]).toBe("1");
    expect(resolved.headers["cf-aig-metadata"]).not.toContain("tenant-secret-id");
  });

  it("fails closed for arbitrary compatible endpoints", () => {
    process.env.CLOUDFLARE_AI_GATEWAY_ENABLED = "true";
    process.env.CLOUDFLARE_AI_GATEWAY_BASE_URL = "https://gateway.example/v1/account/gateway";
    process.env.CLOUDFLARE_API_TOKEN = "cloudflare-platform-token";
    expect(() => resolveCloudflareGateway({ provider: "openai_compatible", directBaseUrl: "https://custom.example/v1" })).toThrow("arbitrary OpenAI-compatible");
  });
});
