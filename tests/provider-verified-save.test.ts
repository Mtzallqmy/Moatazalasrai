import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { hashApiKey } from "@/lib/security/encryption";
import {
  normalizeValidationBaseUrl,
  providerValidationMatches,
  providerValidationTtlSeconds,
} from "@/lib/providers/validation-session";

const originalTtl = process.env.PROVIDER_VALIDATION_TTL_SECONDS;

afterEach(() => {
  if (originalTtl === undefined) delete process.env.PROVIDER_VALIDATION_TTL_SECONDS;
  else process.env.PROVIDER_VALIDATION_TTL_SECONDS = originalTtl;
});

describe("verified provider save", () => {
  const apiKey = "nvapi-production-secret-123456";
  const session = {
    provider: "openai_compatible" as const,
    providerSlug: "nvidia-nim",
    normalizedBaseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyHash: hashApiKey(apiKey),
    testedModel: "meta/llama-3.1-8b-instruct",
  };

  it("binds a validation session to provider, endpoint, key and tested model", () => {
    expect(providerValidationMatches(session, {
      provider: "openai_compatible",
      providerSlug: "nvidia-nim",
      baseUrl: "https://integrate.api.nvidia.com/v1/",
      apiKey,
      testModel: "meta/llama-3.1-8b-instruct",
    })).toBe(true);

    expect(providerValidationMatches(session, {
      provider: "openai_compatible",
      providerSlug: "nvidia-nim",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: `${apiKey}-changed`,
      testModel: "meta/llama-3.1-8b-instruct",
    })).toBe(false);

    expect(providerValidationMatches(session, {
      provider: "openai_compatible",
      providerSlug: "nvidia-nim",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey,
      testModel: "different/model",
    })).toBe(false);
  });

  it("normalizes endpoint slashes and clamps validation TTL", () => {
    expect(normalizeValidationBaseUrl(" https://api.example.com/v1/// ")).toBe("https://api.example.com/v1");
    process.env.PROVIDER_VALIDATION_TTL_SECONDS = "20";
    expect(providerValidationTtlSeconds()).toBe(120);
    process.env.PROVIDER_VALIDATION_TTL_SECONDS = "99999";
    expect(providerValidationTtlSeconds()).toBe(1800);
  });

  it("uses a server-side verification record and one database transaction for the save", async () => {
    const [migration, validateRoute, saveRoute, form] = await Promise.all([
      readFile("drizzle/0015_provider_validation_sessions.sql", "utf8"),
      readFile("src/app/api/dashboard/providers/validate/route.ts", "utf8"),
      readFile("src/app/api/dashboard/providers/verified-save/route.ts", "utf8"),
      readFile("src/components/provider-form.tsx", "utf8"),
    ]);

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "provider_validation_sessions"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE/i);
    expect(validateRoute).toContain('mode: z.enum(["discover", "verify"])');
    expect(validateRoute).toContain("hashApiKey(providerInput.apiKey)");
    expect(saveRoute).toContain("providerValidationMatches");
    expect(saveRoute).toContain("db().transaction");
    expect(saveRoute).toContain("consumedAt: now");
    expect(form).toContain('requestValidation(form, "verify", testModel)');
    expect(form).toContain('/api/dashboard/providers/verified-save');
  });
});
