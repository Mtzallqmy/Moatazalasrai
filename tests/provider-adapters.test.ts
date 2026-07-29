import { describe, expect, it } from "vitest";
import { getProviderAdapter } from "@/lib/providers/registry";

describe("provider adapters", () => {
  it("declares real streaming capabilities for every supported provider", () => {
    for (const provider of ["openai", "anthropic", "gemini", "openai_compatible"] as const) {
      const adapter = getProviderAdapter(provider);
      expect(adapter.capabilities.streaming).toBe(true);
      expect(typeof adapter.generate).toBe("function");
      expect(typeof adapter.stream).toBe("function");
      expect(typeof adapter.discoverModels).toBe("function");
      expect(typeof adapter.testModel).toBe("function");
    }
  });

  it("does not invent missing usage", () => {
    expect(getProviderAdapter("openai").normalizeUsage({})).toEqual({
      inputTokens: null,
      outputTokens: null,
    });
    expect(getProviderAdapter("gemini").normalizeUsage({ promptTokenCount: 10 })).toEqual({
      inputTokens: 10,
      outputTokens: null,
    });
  });
});
