import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPuterModelCache, listPuterModels, normalizePuterModels } from "@/lib/puter/models";
import type { PuterClient } from "@/lib/puter/types";

function clientWith(models: unknown) {
  return { ai: { listModels: vi.fn(async () => models) } } as unknown as PuterClient;
}

afterEach(() => {
  clearPuterModelCache();
  Reflect.deleteProperty(globalThis, "sessionStorage");
});

describe("Puter model discovery", () => {
  it("normalizes optional metadata and keeps the exact model id", () => {
    expect(normalizePuterModels([
      { id: "openai/gpt-x", name: "GPT X", provider: "openai", context: 1000, max_tokens: 120, capabilities: { chat: true, vision: true } },
      { id: "minimal" },
      { id: "no-chat", capabilities: { chat: false } },
    ])).toEqual([
      { id: "openai/gpt-x", name: "GPT X", provider: "openai", contextWindow: 1000, maxOutputTokens: 120, capabilities: ["chat", "vision"], cost: null },
      { id: "minimal", name: "minimal", provider: "puter", contextWindow: null, maxOutputTokens: null, capabilities: [], cost: null },
    ]);
  });

  it("caches results and force reload bypasses the cache", async () => {
    const client = clientWith([{ id: "model-a" }]);
    await listPuterModels({ client });
    await listPuterModels({ client });
    await listPuterModels({ client, force: true });
    expect(client.ai.listModels).toHaveBeenCalledTimes(2);
  });

  it("maps discovery failures to a safe Arabic message", async () => {
    const client = { ai: { listModels: vi.fn(async () => { throw new Error("secret payload"); }) } } as unknown as PuterClient;
    await expect(listPuterModels({ client, force: true })).rejects.toThrow("تعذر تحميل نماذج Puter");
  });
});
