import { describe, expect, it } from "vitest";
import { providerInputSchema, providerValidationSchema } from "@/lib/http/contracts";

describe("Cloudflare provider contracts", () => {
  it("accepts provider-native routing with a key alias and no provider key in the request", () => {
    const parsed = providerInputSchema.parse({
      provider: "openai",
      providerTypeId: "cloudflare-ai-gateway",
      providerSlug: "openai",
      name: "Gateway OpenAI",
      transportMode: "cloudflare_ai_gateway_native",
      credentialMode: "cloudflare_provider_key",
      gatewayId: "production",
      keyAlias: "primary",
      testModel: "gpt-4.1",
    });
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.keyAlias).toBe("primary");
  });

  it("rejects incomplete Cloudflare routing", () => {
    expect(() => providerInputSchema.parse({
      provider: "anthropic",
      providerTypeId: "cloudflare-ai-gateway",
      name: "Incomplete",
      transportMode: "cloudflare_ai_gateway_native",
      credentialMode: "cloudflare_provider_key",
      testModel: "claude-test",
    })).toThrow("Gateway ID");
  });

  it("rejects BYOK on Workers AI binding", () => {
    expect(() => providerValidationSchema.parse({
      provider: "openai",
      providerTypeId: "cloudflare-workers-ai",
      providerSlug: "cloudflare-workers-ai",
      transportMode: "cloudflare_workers_ai",
      credentialMode: "encrypted_byok",
      apiKey: "not-allowed",
      testModel: "@cf/meta/llama-3.1-8b-instruct",
    })).toThrow("binding");
  });
});
