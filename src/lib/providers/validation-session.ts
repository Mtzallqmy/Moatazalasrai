import { secureHashEquals } from "@/lib/security/encryption";
import type { ProviderKind } from "@/lib/providers/types";

export function normalizeValidationBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function providerValidationTtlSeconds() {
  const configured = Number(process.env.PROVIDER_VALIDATION_TTL_SECONDS ?? 600);
  if (!Number.isFinite(configured)) return 600;
  return Math.min(1800, Math.max(120, Math.floor(configured)));
}

export function providerValidationMatches(
  session: {
    provider: ProviderKind;
    providerSlug: string;
    normalizedBaseUrl: string;
    apiKeyHash: string;
    testedModel: string;
  },
  input: {
    provider: ProviderKind;
    providerSlug: string;
    baseUrl: string;
    apiKey: string;
    testModel: string;
  },
) {
  return session.provider === input.provider
    && session.providerSlug === input.providerSlug
    && normalizeValidationBaseUrl(session.normalizedBaseUrl) === normalizeValidationBaseUrl(input.baseUrl)
    && session.testedModel === input.testModel
    && secureHashEquals(session.apiKeyHash, input.apiKey);
}
