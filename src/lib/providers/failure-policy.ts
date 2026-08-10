import { isRetryableProviderError } from "@/lib/providers/errors";
import { ProviderError } from "@/lib/providers/types";

const CREDENTIAL_SCOPED_ERRORS = new Set([
  "PROVIDER_PAYMENT_REQUIRED",
  "PROVIDER_UNAUTHORIZED",
  "PROVIDER_FORBIDDEN",
  "PROVIDER_SECRET_REFERENCE_MISSING",
]);

const NON_FALLBACK_ERRORS = new Set([
  "PROVIDER_CANCELLED",
  "PROVIDER_RESPONSE_TOO_LARGE",
  "PROVIDER_CAPACITY_EXHAUSTED",
  "PROVIDER_UNAUTHORIZED",
  "PROVIDER_FORBIDDEN",
  "PROVIDER_PAYMENT_REQUIRED",
  "PROVIDER_ENDPOINT_NOT_FOUND",
  "MODEL_UNAVAILABLE",
  "PROVIDER_REJECTED_INPUT",
  "CONTEXT_TOO_LARGE",
  "PROVIDER_CONFIG_INVALID",
  "PROVIDER_SECRET_REFERENCE_MISSING",
]);

export function providerFallbackEnabled(value = process.env.AI_PROVIDER_FALLBACK_ENABLED) {
  return value?.trim().toLowerCase() === "true";
}

export function isCredentialScopedProviderError(error: ProviderError) {
  return CREDENTIAL_SCOPED_ERRORS.has(error.code);
}

export function shouldFallbackProviderError(error: ProviderError) {
  if (!providerFallbackEnabled()) return false;
  if (NON_FALLBACK_ERRORS.has(error.code)) return false;
  return isRetryableProviderError(error);
}

export function providerCircuitOpenUntil(error: ProviderError, failures: number, now = new Date()) {
  const start = now.getTime();
  if (error.code === "PROVIDER_PAYMENT_REQUIRED") return new Date(start + 24 * 60 * 60_000);
  if (error.code === "PROVIDER_UNAUTHORIZED" || error.code === "PROVIDER_FORBIDDEN" || error.code === "PROVIDER_SECRET_REFERENCE_MISSING") {
    return new Date(start + 60 * 60_000);
  }
  if (error.code === "PROVIDER_RATE_LIMITED" || error.code === "PROVIDER_CAPACITY_EXHAUSTED") {
    return new Date(start + Math.max(60_000, error.retryAfterMs ?? 60_000));
  }
  if (failures >= 3 && isRetryableProviderError(error)) {
    return new Date(start + 5 * 60_000);
  }
  return null;
}

export function prioritizeProviderCandidates<T extends { providerCredentialId: string; model: string }>(
  ranked: T[],
  preferred: (candidate: T) => boolean,
  limit = 6,
) {
  const result: T[] = [];
  const seen = new Set<string>();
  const add = (candidate: T) => {
    const key = `${candidate.providerCredentialId}:${candidate.model}`;
    if (seen.has(key) || result.length >= limit) return;
    seen.add(key);
    result.push(candidate);
  };

  ranked.filter(preferred).forEach(add);

  const seenCredentials = new Set(result.map((candidate) => candidate.providerCredentialId));
  for (const candidate of ranked) {
    if (result.length >= limit) break;
    if (seenCredentials.has(candidate.providerCredentialId)) continue;
    add(candidate);
    seenCredentials.add(candidate.providerCredentialId);
  }

  ranked.forEach(add);
  return result;
}
