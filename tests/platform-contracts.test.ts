import { describe, expect, it } from "vitest";
import { errorDescriptor, platformErrors } from "@/contracts/errors";
import { listIntegrationAdapters } from "@/server/integrations/registry";

describe("platform contracts", () => {
  it("provides safe bilingual recovery metadata for operational errors", () => {
    for (const [code, descriptor] of Object.entries(platformErrors)) {
      expect(code).toMatch(/^[A-Z0-9_]+$/);
      expect(descriptor.status).toBeGreaterThanOrEqual(400);
      expect(descriptor.messageAr).not.toContain("Authorization");
      expect(descriptor.actionAr.length).toBeGreaterThan(5);
      expect(descriptor.actionEn.length).toBeGreaterThan(5);
    }
    expect(errorDescriptor("PROVIDER_TIMEOUT")?.retryable).toBe(true);
    expect(errorDescriptor("PROVIDER_UNAUTHORIZED")?.retryable).toBe(false);
  });

  it("registers Telegram and GitHub behind a stable adapter contract", () => {
    const adapters = listIntegrationAdapters();
    expect(adapters.map((adapter) => adapter.id).sort()).toEqual(["github", "telegram"]);
    expect(adapters.find((adapter) => adapter.id === "telegram")?.capabilities).toContain("webhook");
    expect(adapters.find((adapter) => adapter.id === "github")?.capabilities).toContain("read_file");
  });
});
