import { describe, expect, it } from "vitest";
import { inferModelCapabilities, isFreeTierModel } from "@/server/models/capabilities";

describe("model capability inference", () => {
  it("marks known multimodal model families as vision capable", () => {
    expect(inferModelCapabilities("openai", "gpt-4o-mini").vision).toBe(true);
    expect(inferModelCapabilities("anthropic", "claude-3-7-sonnet").vision).toBe(true);
    expect(inferModelCapabilities("gemini", "gemini-2.0-flash").vision).toBe(true);
    expect(inferModelCapabilities("openai_compatible", "qwen/qwen2.5-vl-72b").vision).toBe(true);
  });

  it("does not claim vision or audio support for a text-only model", () => {
    const result = inferModelCapabilities("openai_compatible", "openai/gpt-oss-20b:free");
    expect(result.text).toBe(true);
    expect(result.vision).toBe(false);
    expect(result.audio).toBe(false);
  });

  it("recognizes explicit free-tier model identifiers", () => {
    expect(isFreeTierModel("openai/gpt-oss-20b:free")).toBe(true);
    expect(isFreeTierModel("gpt-4o-mini")).toBe(false);
  });
});
