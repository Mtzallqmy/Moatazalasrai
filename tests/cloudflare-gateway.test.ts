import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMGateway } from "@/lib/providers/llm-gateway";

const gatewayRoot = "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id";
const directOpenAi = "https://api.openai.com/v1";

function configureGateway() {
  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_AI_GATEWAY_ID = "gateway-id";
  process.env.CLOUDFLARE_AI_GATEWAY_TOKEN = "gateway-auth-token";
}

function gatewayWith(fetchMock?: typeof globalThis.fetch) {
  return new LLMGateway({ fetch: fetchMock, validateUrl: async () => undefined, log: () => undefined });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of [
    "CLOUDFLARE_AI_GATEWAY_ENABLED", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_GATEWAY_ID",
    "CLOUDFLARE_AI_GATEWAY_TOKEN", "CLOUDFLARE_API_TOKEN", "AI_PROVIDER_FALLBACK_ENABLED",
    "AI_PROVIDER_DIRECT_FALLBACK_ENABLED",
  ]) delete process.env[key];
});

describe("LLMGateway", () => {
  it("keeps requests direct unless native gateway transport is selected", () => {
    const gateway = gatewayWith();
    expect(gateway.resolve({ provider: "openai", directBaseUrl: `${directOpenAi}/`, transportMode: "direct" })).toMatchObject({
      baseUrl: directOpenAi,
      headers: {},
      gateway: false,
    });
  });

  it.each([
    ["openai", `${gatewayRoot}/openai`],
    ["anthropic", `${gatewayRoot}/anthropic`],
    ["gemini", `${gatewayRoot}/google-ai-studio/v1`],
  ] as const)("constructs the provider-native %s endpoint centrally", (provider, expected) => {
    configureGateway();
    const transport = gatewayWith().resolve({
      provider,
      directBaseUrl: provider === "openai" ? directOpenAi : `https://${provider}.example`,
      transportMode: "cloudflare_ai_gateway_native",
      gatewayId: "gateway-id",
      skipCache: true,
      cacheTtl: 60,
      collectLog: false,
    });
    expect(transport.baseUrl).toBe(expected);
    expect(transport.headers).toMatchObject({
      "cf-aig-authorization": "Bearer gateway-auth-token",
      "cf-aig-skip-cache": "true",
      "cf-aig-cache-ttl": "60",
      "cf-aig-collect-log": "false",
    });
  });

  it("uses a Cloudflare provider key alias without forwarding the provider secret header", async () => {
    configureGateway();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      transportMode: "cloudflare_ai_gateway_native",
      keyAlias: "production",
    });
    await transport.fetch!(`${transport.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: "Bearer placeholder", "content-type": "application/json" },
      body: "{}",
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cf-aig-byok-alias")).toBe("production");
    expect(headers.get("cf-aig-authorization")).toBe("Bearer gateway-auth-token");
  });

  it("never falls back directly when Cloudflare owns the provider key", async () => {
    configureGateway();
    process.env.AI_PROVIDER_FALLBACK_ENABLED = "true";
    process.env.AI_PROVIDER_DIRECT_FALLBACK_ENABLED = "true";
    const fetchMock = vi.fn().mockResolvedValue(new Response("gateway unavailable", { status: 503 }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      transportMode: "cloudflare_ai_gateway_native",
      keyAlias: "production",
    });
    const response = await transport.fetch!(`${transport.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: "Bearer placeholder" },
      body: "{}",
    });
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not silently fall back when the policy is disabled", async () => {
    configureGateway();
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 503 }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      transportMode: "cloudflare_ai_gateway_native",
    });
    const response = await transport.fetch!(`${transport.baseUrl}/responses`, { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back once only for an explicitly enabled transient failure", async () => {
    configureGateway();
    process.env.AI_PROVIDER_FALLBACK_ENABLED = "true";
    process.env.AI_PROVIDER_DIRECT_FALLBACK_ENABLED = "true";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      transportMode: "cloudflare_ai_gateway_native",
    });
    const response = await transport.fetch!(`${transport.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: "Bearer byok", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${directOpenAi}/responses`);
  });

  it("never falls back on an authentication error", async () => {
    configureGateway();
    process.env.AI_PROVIDER_FALLBACK_ENABLED = "true";
    process.env.AI_PROVIDER_DIRECT_FALLBACK_ENABLED = "true";
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      transportMode: "cloudflare_ai_gateway_native",
    });
    const response = await transport.fetch!(`${transport.baseUrl}/responses`, { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replay a stream after the response has started", async () => {
    configureGateway();
    process.env.AI_PROVIDER_FALLBACK_ENABLED = "true";
    process.env.AI_PROVIDER_DIRECT_FALLBACK_ENABLED = "true";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
        controller.error(new Error("stream interrupted"));
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      transportMode: "cloudflare_ai_gateway_native",
    });
    const response = await transport.fetch!(`${transport.baseUrl}/responses`, { method: "POST", body: "{}" });
    const reader = response.body!.getReader();
    await expect(reader.read()).rejects.toThrow("stream interrupted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
