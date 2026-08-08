import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/security/provider-network", () => ({
  validateProviderBaseUrl: vi.fn(async (url: string) => ({ normalizedUrl: url, addresses: ["203.0.113.10"] })),
}));

import { providerJson, providerStream, sseJson } from "@/lib/providers/http";

describe("provider HTTP resilience", () => {
  it("parses the final SSE event even when the provider omits the trailing separator", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"complete"}'));
        controller.close();
      },
    });
    const events: Record<string, unknown>[] = [];
    for await (const event of sseJson(new Response(stream), { idleTimeoutMs: 100 })) events.push(event);
    expect(events).toEqual([{ type: "complete" }]);
  });

  it("fails a silent provider stream with a retryable timeout", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull() {} });
    const consume = async () => {
      for await (const event of sseJson(new Response(stream), { idleTimeoutMs: 10 })) {
        throw new Error(`Unexpected provider event: ${JSON.stringify(event)}`);
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });
  });

  it("uses the request timeout for headers without truncating a healthy long stream", async () => {
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        controller.enqueue(new TextEncoder().encode('data: {"delta":"ready"}\n\n'));
        controller.close();
      },
    }), { status: 200 }));
    const response = await providerStream("https://provider.example/v1/chat", { method: "POST" }, {
      timeoutMs: 5,
      fetch: fetchImpl as typeof fetch,
    });
    const events: Record<string, unknown>[] = [];
    for await (const event of sseJson(response, { idleTimeoutMs: 100 })) events.push(event);
    expect(events).toEqual([{ delta: "ready" }]);
  });

  it("cancels retry backoff immediately when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => new Response('{"error":{"message":"busy"}}', {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "1" },
    }));
    setTimeout(() => controller.abort(), 10);
    const startedAt = performance.now();
    await expect(providerJson("https://provider.example/v1/models", {}, {
      retries: 1,
      signal: controller.signal,
      fetch: fetchImpl as typeof fetch,
    })).rejects.toMatchObject({ code: "PROVIDER_CANCELLED" });
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
