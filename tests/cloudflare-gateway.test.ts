import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMGateway } from "@/lib/providers/llm-gateway";

const gatewayRoot = "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id";
const directOpenAi = "https://api.openai.com/v1";

function enableGateway() {
  process.env.CLOUDFLARE_AI_GATEWAY_ENABLED = "true";
  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_AI_GATEWAY_ID = "gateway-id";
  process.env.OPENAI_BASE_URL = `${gatewayRoot}/compat`;
}

function gatewayWith(fetchMock?: typeof globalThis.fetch) {
  return new LLMGateway({
    fetch: fetchMock,
    validateUrl: async () => undefined,
    log: () => undefined,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of [
    "CLOUDFLARE_AI_GATEWAY_ENABLED",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_AI_GATEWAY_ID",
    "CLOUDFLARE_API_TOKEN",
    "OPENAI_BASE_URL",
  ]) delete process.env[key];
});

describe("LLMGateway", () => {
  it("keeps every provider direct when the gateway is disabled", () => {
    const gateway = gatewayWith();
    expect(gateway.resolve({ provider: "openai", directBaseUrl: `${directOpenAi}/` })).toMatchObject({
      baseUrl: directOpenAi,
      headers: {},
      gateway: false,
    });
  });

  it("routes OpenAI through the provider-native sibling to preserve Responses API", () => {
    enableGateway();
    process.env.CLOUDFLARE_API_TOKEN = "gateway-auth-token";
    const transport = gatewayWith().resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      organizationId: "tenant-secret-id",
      requestId: "request-1",
    });

    expect(transport).toMatchObject({
      gateway: true,
      configuredUrl: `${gatewayRoot}/compat`,
      baseUrl: `${gatewayRoot}/openai`,
    });
    expect(transport.headers["cf-aig-authorization"]).toBe("Bearer gateway-auth-token");
    expect(transport.headers["cf-aig-skip-cache"]).toBe("true");
    expect(transport.headers["cf-aig-collect-log"]).toBe("false");
    expect(transport.headers["cf-aig-max-attempts"]).toBe("1");
    expect(transport.headers["cf-aig-request-timeout"]).toBe("60000");
    expect(transport.headers["cf-aig-metadata"]).not.toContain("tenant-secret-id");
  });

  it.each(["anthropic", "gemini", "openai_compatible"] as const)(
    "keeps %s on its existing direct adapter",
    (provider) => {
      enableGateway();
      const directBaseUrl = `https://${provider}.example/v1`;
      expect(gatewayWith().resolve({ provider, directBaseUrl })).toMatchObject({
        baseUrl: directBaseUrl,
        headers: {},
        gateway: false,
      });
    },
  );

  it("retries once by falling back directly on a retryable status", async () => {
    enableGateway();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      requestId: "retry-request",
    });

    const response = await transport.fetch!(`${transport.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: "Bearer user-byok", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", input: "private" }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${gatewayRoot}/openai/responses`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${directOpenAi}/responses`);
    const directHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(directHeaders.get("authorization")).toBe("Bearer user-byok");
    expect([...directHeaders.keys()].some((name) => name.startsWith("cf-aig-"))).toBe(false);
  });

  it("falls back once after a gateway timeout without swallowing cancellation", async () => {
    enableGateway();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      requestId: "timeout-request",
    });

    const response = await transport.fetch!(`${transport.baseUrl}/responses`, {
      method: "POST",
      body: JSON.stringify({ model: "gpt-test", input: "private" }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not retry after a streaming response has started", async () => {
    enableGateway();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
        controller.error(new Error("stream interrupted"));
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const transport = gatewayWith(fetchMock as unknown as typeof globalThis.fetch).resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
      requestId: "stream-request",
    });

    const response = await transport.fetch!(`${transport.baseUrl}/responses`, {
      method: "POST",
      body: JSON.stringify({ model: "gpt-test", stream: true }),
    });
    const reader = response.body!.getReader();
    await expect(reader.read()).rejects.toThrow("stream interrupted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a gateway URL that does not match the configured account", () => {
    enableGateway();
    process.env.OPENAI_BASE_URL = "https://gateway.ai.cloudflare.com/v1/other/gateway-id/compat";
    expect(() => gatewayWith().resolve({
      provider: "openai",
      directBaseUrl: directOpenAi,
    })).toThrow("does not match");
  });
});
