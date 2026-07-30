import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  isCredentialScopedProviderError,
  prioritizeProviderCandidates,
  providerCircuitOpenUntil,
  shouldFallbackProviderError,
} from "@/lib/providers/failure-policy";
import { providerErrorForHttpStatus, providerErrorFromPayload } from "@/lib/providers/http";

describe("provider failure recovery", () => {
  it("classifies HTTP 402 as an actionable credential-scoped billing failure", () => {
    const error = providerErrorForHttpStatus(402, JSON.stringify({
      error: { type: "payment_required", message: "Insufficient credits" },
    }));
    expect(error.code).toBe("PROVIDER_PAYMENT_REQUIRED");
    expect(error.httpStatus).toBe(402);
    expect(error.providerStatus).toBe(402);
    expect(error.retryable).toBe(false);
    expect(isCredentialScopedProviderError(error)).toBe(true);
    expect(shouldFallbackProviderError(error)).toBe(true);
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(providerCircuitOpenUntil(error, 1, now)?.toISOString())
      .toBe("2026-07-31T12:00:00.000Z");
  });

  it("recognizes payment failures emitted inside a successful HTTP stream", () => {
    const error = providerErrorFromPayload({
      error: { code: 402, type: "payment_required", message: "Insufficient credits" },
    });
    expect(error.code).toBe("PROVIDER_PAYMENT_REQUIRED");
  });

  it("honors Retry-After for temporary provider limits", () => {
    const headers = new Headers({ "retry-after": "15" });
    const error = providerErrorForHttpStatus(429, "", headers);
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.retryAfterMs).toBe(15_000);
    expect(providerCircuitOpenUntil(error, 1, new Date(0))?.getTime()).toBe(60_000);
  });

  it("keeps the requested model first while diversifying fallback credentials", () => {
    const ranked = [
      { providerCredentialId: "a", model: "cheap" },
      { providerCredentialId: "a", model: "requested" },
      { providerCredentialId: "a", model: "other" },
      { providerCredentialId: "b", model: "backup-b" },
      { providerCredentialId: "c", model: "backup-c" },
    ];
    const selected = prioritizeProviderCandidates(
      ranked,
      (candidate) => candidate.providerCredentialId === "a" && candidate.model === "requested",
      5,
    );
    expect(selected[0]).toEqual({ providerCredentialId: "a", model: "requested" });
    expect(selected.slice(1, 3).map((candidate) => candidate.providerCredentialId))
      .toEqual(["b", "c"]);
    expect(new Set(selected.map((candidate) => `${candidate.providerCredentialId}:${candidate.model}`)).size)
      .toBe(selected.length);
  });

  it("ships additive provider health persistence and runtime attempt recording", async () => {
    const [migration, runtime] = await Promise.all([
      readFile("drizzle/0013_provider_runtime_health.sql", "utf8"),
      readFile("src/lib/agents/runtime.ts", "utf8"),
    ]);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "provider_credential_health_events"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE/i);
    expect(runtime).toContain("recordCredentialFailure");
    expect(runtime).toContain("blockedCredentialIds");
    expect(runtime).toContain("fallbackUsed");
  });
});
