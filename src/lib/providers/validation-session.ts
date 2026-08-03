import { createHash } from "node:crypto";
import { secureHashEquals } from "@/lib/security/encryption";
import type { ProviderCredentialMode, ProviderKind, ProviderTransportMode, ProviderTypeId } from "@/lib/providers/types";

export function normalizeValidationBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function providerValidationTtlSeconds() {
  const configured = Number(process.env.PROVIDER_VALIDATION_TTL_SECONDS ?? 600);
  if (!Number.isFinite(configured)) return 600;
  return Math.min(1800, Math.max(120, Math.floor(configured)));
}

export function providerValidationConfigHash(input: {
  provider: ProviderKind;
  providerTypeId: ProviderTypeId;
  providerSlug: string;
  transportMode: ProviderTransportMode;
  credentialMode: ProviderCredentialMode;
  baseUrl: string;
  gatewayId?: string | null;
  keyAlias?: string | null;
  testModel: string;
  allowedModels?: string[];
  skipCache?: boolean;
  cacheTtl?: number | null;
  collectLog?: boolean;
}) {
  const stable = JSON.stringify({
    provider: input.provider,
    providerTypeId: input.providerTypeId,
    providerSlug: input.providerSlug,
    transportMode: input.transportMode,
    credentialMode: input.credentialMode,
    baseUrl: normalizeValidationBaseUrl(input.baseUrl),
    gatewayId: input.gatewayId?.trim() || null,
    keyAlias: input.keyAlias?.trim() || null,
    testModel: input.testModel.trim(),
    allowedModels: [...new Set(input.allowedModels ?? [])].sort(),
    skipCache: input.skipCache ?? true,
    cacheTtl: input.cacheTtl ?? null,
    collectLog: input.collectLog ?? false,
  });
  return createHash("sha256").update(stable).digest("hex");
}

export function providerValidationMatches(
  session: {
    provider: ProviderKind;
    providerTypeId: string | null;
    providerSlug: string;
    transportMode: string;
    credentialMode: string;
    gatewayId: string | null;
    keyAlias: string | null;
    normalizedBaseUrl: string;
    apiKeyHash: string | null;
    configHash: string | null;
    testedModel: string;
  },
  input: {
    provider: ProviderKind;
    providerTypeId: ProviderTypeId;
    providerSlug: string;
    transportMode: ProviderTransportMode;
    credentialMode: ProviderCredentialMode;
    gatewayId?: string | null;
    keyAlias?: string | null;
    baseUrl: string;
    apiKey?: string;
    testModel: string;
    allowedModels?: string[];
    skipCache?: boolean;
    cacheTtl?: number | null;
    collectLog?: boolean;
  },
) {
  const configHash = providerValidationConfigHash(input);
  const apiKeyMatches = input.credentialMode !== "encrypted_byok"
    ? session.apiKeyHash === null
    : Boolean(session.apiKeyHash && input.apiKey && secureHashEquals(session.apiKeyHash, input.apiKey));
  return session.provider === input.provider
    && session.providerTypeId === input.providerTypeId
    && session.providerSlug === input.providerSlug
    && session.transportMode === input.transportMode
    && session.credentialMode === input.credentialMode
    && (session.gatewayId ?? null) === (input.gatewayId?.trim() || null)
    && (session.keyAlias ?? null) === (input.keyAlias?.trim() || null)
    && normalizeValidationBaseUrl(session.normalizedBaseUrl) === normalizeValidationBaseUrl(input.baseUrl)
    && session.testedModel === input.testModel
    && session.configHash === configHash
    && apiKeyMatches;
}
