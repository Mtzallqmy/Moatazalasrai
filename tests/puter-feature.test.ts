import { describe, expect, it } from "vitest";
import { isPuterEnabled, PUTER_PROVIDER_METADATA } from "@/lib/puter/feature";
import { assertPuterCapabilitySupported, PUTER_UNSUPPORTED_SERVER_CAPABILITIES } from "@/lib/puter/capabilities";
import { providerAdapters } from "@/lib/providers/adapters";

 describe("Puter feature metadata", () => {
  it("is disabled unless the public flag is exactly true", () => {
    expect(isPuterEnabled(undefined)).toBe(false);
    expect(isPuterEnabled("false")).toBe(false);
    expect(isPuterEnabled("true")).toBe(true);
  });

  it("is client-managed and never enters the server provider union", () => {
    expect(PUTER_PROVIDER_METADATA).toMatchObject({
      id: "puter",
      execution: "client",
      credentialMode: "user-account",
      supportsServerRuns: false,
      supportsBackgroundWorker: false,
    });
    expect(Object.keys(providerAdapters)).toEqual(["openai", "anthropic", "gemini", "openai_compatible"]);
  });

  it.each(PUTER_UNSUPPORTED_SERVER_CAPABILITIES)("fails closed for %s", (capability) => {
    expect(() => assertPuterCapabilitySupported(capability)).toThrowError(/جلسة المتصفح/);
  });
});
