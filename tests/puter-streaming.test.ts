import { describe, expect, it, vi } from "vitest";
import { streamPuterChat } from "@/lib/puter/chat";
import type { PuterChatChunk, PuterClient } from "@/lib/puter/types";

function clientFrom(chunks: PuterChatChunk[]) {
  return {
    ai: {
      chat: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
      })),
    },
  } as unknown as PuterClient;
}

describe("Puter streaming adapter", () => {
  it("collects text deltas and ignores non-text chunks", async () => {
    const onText = vi.fn();
    const result = await streamPuterChat({
      client: clientFrom([{ type: "reasoning", reasoning: "hidden" }, { type: "text", text: "مر" }, { type: "usage", usage: { total: 2 } }, { type: "text", text: "حبًا" }]),
      messages: [{ role: "user", content: "مرحبا", images: [] }],
      model: "model-a",
      onText,
    });
    expect(result).toBe("مرحبًا");
    expect(onText.mock.calls.flat()).toEqual(["مر", "حبًا"]);
  });

  it("surfaces error chunks", async () => {
    await expect(streamPuterChat({
      client: clientFrom([{ type: "error", message: "رفض Puter" } as PuterChatChunk & { message: string }]),
      messages: [{ role: "user", content: "x", images: [] }],
      model: "model-a",
      onText: () => undefined,
    })).rejects.toThrow("رفض Puter");
  });

  it("stops UI delivery after local cancellation", async () => {
    const controller = new AbortController();
    const onText = vi.fn(() => controller.abort());
    await expect(streamPuterChat({
      client: clientFrom([{ type: "text", text: "أ" }, { type: "text", text: "ب" }]),
      messages: [{ role: "user", content: "x", images: [] }],
      model: "model-a",
      signal: controller.signal,
      onText,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(onText).toHaveBeenCalledTimes(1);
  });
});
