import { ProviderError } from "@/lib/providers/types";

const CREDENTIAL_SCOPED_ERRORS = new Set([
  "PROVIDER_PAYMENT_REQUIRED",
  "PROVIDER_UNAUTHORIZED",
  "PROVIDER_FORBIDDEN",
]);

const NON_FALLBACK_ERRORS = new Set([
  "PROVIDER_CANCELLED",
  "PROVIDER_RESPONSE_TOO_LARGE",
]);

export function isCredentialScopedProviderError(error: ProviderError) {
  return CREDENTIAL_SCOPED_ERRORS.has(error.code);
}

export function shouldFallbackProviderError(error: ProviderError) {
  return !NON_FALLBACK_ERRORS.has(error.code);
}

export function providerCircuitOpenUntil(error: ProviderError, failures: number, now = new Date()) {
  const start = now.getTime();
  if (error.code === "PROVIDER_PAYMENT_REQUIRED") return new Date(start + 24 * 60 * 60_000);
  if (error.code === "PROVIDER_UNAUTHORIZED" || error.code === "PROVIDER_FORBIDDEN") {
    return new Date(start + 60 * 60_000);
  }
  if (error.code === "PROVIDER_RATE_LIMITED") {
    return new Date(start + Math.max(60_000, error.retryAfterMs ?? 60_000));
  }
  if (failures >= 3 && (error.retryable || error.code === "PROVIDER_NETWORK_ERROR")) {
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
