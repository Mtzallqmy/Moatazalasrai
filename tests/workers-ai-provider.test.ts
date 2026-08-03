import { describe, expect, it, vi } from "vitest";
import { runWorkersAiChat, streamWorkersAiChat, validateWorkersAiModel } from "@/lib/providers/workers-ai";

describe("Workers AI provider", () => {
  it("rejects non-Workers-AI model identifiers", () => {
    expect(() => validateWorkersAiModel("gpt-4")).toThrow("@cf/");
  });

  it("calls env.AI-compatible binding with explicit gateway privacy options", async () => {
    const run = vi.fn().mockResolvedValue({ response: "OK", usage: { prompt_tokens: 2, completion_tokens: 1 } });
    const result = await runWorkersAiChat({
      model: "@cf/meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0,
      maxOutputTokens: 16,
      gatewayId: "gateway",
      skipCache: true,
      cacheTtl: 60,
      collectLog: false,
      binding: { run },
    });
    expect(result).toMatchObject({ text: "OK", inputTokens: 2, outputTokens: 1 });
    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct",
      expect.objectContaining({ max_tokens: 16 }),
      { gateway: { id: "gateway", skipCache: true, cacheTtl: 60, collectLog: false } },
    );
  });

  it("marks a stream interruption as a provider error instead of a completed reply", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"response":"partial"}\n\n'));
        controller.error(new Error("socket closed"));
      },
    });
    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of streamWorkersAiChat({
        model: "@cf/meta/llama-3.1-8b-instruct",
        messages: [{ role: "user", content: "test" }],
        temperature: 0,
        maxOutputTokens: 16,
        binding: { run: vi.fn().mockResolvedValue(stream) },
      })) {
        if (chunk.type === "delta") chunks.push(chunk.text);
      }
    }).rejects.toMatchObject({ code: "PROVIDER_NETWORK_ERROR" });
    expect(chunks).toEqual(["partial"]);
  });
});
