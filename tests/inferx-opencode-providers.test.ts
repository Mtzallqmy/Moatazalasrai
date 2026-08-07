import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getProviderPreset } from "@/lib/providers/catalog";
import { inferProviderSlug } from "@/lib/providers/registry";

describe("InferX and OpenCode providers", () => {
  it("registers InferX as the published OpenAI-compatible endpoint with a real starter model", () => {
    const inferx = getProviderPreset("inferx");
    expect(inferx).toMatchObject({
      provider: "openai_compatible",
      apiStyle: "openai_chat",
      defaultBaseUrl: "https://model.inferx.net/endpoints/v1",
      starterModel: "deepseek-v4-flash",
      baseUrlEditable: false,
    });
    expect(inferProviderSlug("openai_compatible", "https://model.inferx.net/endpoints/v1/")).toBe("inferx");
  });

  it("registers OpenCode Zen only for its documented Chat Completions model family", () => {
    const opencode = getProviderPreset("opencode-zen");
    expect(opencode).toMatchObject({
      provider: "openai_compatible",
      apiStyle: "openai_chat",
      defaultBaseUrl: "https://opencode.ai/zen/v1",
      starterModel: "deepseek-v4-flash-free",
      baseUrlEditable: false,
    });
    expect(inferProviderSlug("openai_compatible", "https://opencode.ai/zen/v1")).toBe("opencode-zen");
  });

  it("uses the existing real discovery and generation adapter instead of a provider placeholder", async () => {
    const adapters = await readFile("src/lib/providers/adapters.ts", "utf8");
    const registry = await readFile("src/lib/providers/registry.ts", "utf8");
    expect(adapters).toContain('joinUrl(input.baseUrl, "models")');
    expect(adapters).toContain('joinUrl(input.baseUrl, "chat/completions")');
    expect(adapters).toContain("PROVIDER_EMPTY_OUTPUT");
    expect(registry).toContain("adapter.testModel");
    expect(registry).toContain("model_generation");
  });

  it("prefills starter models but still requires server-side generation verification before saving", async () => {
    const form = await readFile("src/components/provider-form.tsx", "utf8");
    expect(form).toContain("setManualModel(next.starterModel ?? \"\")");
    expect(form).toContain('mode: "verify"');
    expect(form).toContain("verified.data.modelTest");
    expect(form).toContain("validationId");
    expect(form).toContain("الحفظ يتطلب طلب توليد حقيقي ناجح");
  });
});
