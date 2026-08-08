import { describe, expect, it } from "vitest";
import { splitServerEvents } from "@/lib/chat/sse";

describe("chat SSE client parser", () => {
  it("keeps partial chunks and parses multiline data", () => {
    const first = splitServerEvents('event: delta\ndata: {"text":"مر');
    expect(first.events).toEqual([]);
    expect(first.remainder).toContain("مر");

    const second = splitServerEvents(`${first.remainder}حبا"}\n\nevent: complete\ndata: {"messageId":"m1"}\n\n`);
    expect(second.events).toEqual([
      { event: "delta", data: '{"text":"مرحبا"}' },
      { event: "complete", data: '{"messageId":"m1"}' },
    ]);
    expect(second.remainder).toBe("");
  });

  it("flushes a final event even without a trailing separator", () => {
    expect(splitServerEvents('event: complete\ndata: {"messageId":"m1"}', true).events).toEqual([
      { event: "complete", data: '{"messageId":"m1"}' },
    ]);
  });
});
