import { describe, expect, it } from "vitest";
import { selectBestModel, type RoutableModel } from "@/server/models/router";

const base: RoutableModel = {
  providerCredentialId: "provider",
  model: "discovered-model",
  available: true,
  freeTierEligible: false,
  latencyMs: 800,
  capabilities: { text: true, files: true, vision: false, coding: true },
};

describe("model router", () => {
  it("prioritizes an eligible free model without fixed model names", () => {
    const paid = { ...base, model: "paid", isOrganizationDefault: true };
    const free = { ...base, model: "free", freeTierEligible: true };
    expect(selectBestModel([paid, free], "text")?.model).toBe("free");
  });

  it("rejects models missing the required capability", () => {
    const textOnly = { ...base, capabilities: { text: true, vision: false } };
    const vision = { ...base, model: "vision", capabilities: { text: true, vision: true } };
    expect(selectBestModel([textOnly, vision], "image")?.model).toBe("vision");
  });

  it("returns null when no safe model is available", () => {
    expect(selectBestModel([{ ...base, available: false }], "analysis")).toBeNull();
  });
});
