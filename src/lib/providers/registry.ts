import { providerAdapters } from "@/lib/providers/adapters";
import { canonicalizeProviderBaseUrl } from "@/lib/providers/base-url";
import {
  defaultProviderSlug,
  getProviderPreset,
  providerPresets,
  resolveProviderPreset,
} from "@/lib/providers/catalog";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";
import { runCloudflareRestChat, validateCloudflareRestModel } from "@/lib/providers/cloudflare-rest";
import { defaultProviderTypeId, validateCredentialTransport } from "@/lib/providers/provider-config";
import { providerRegistry } from "@/lib/providers/platform-registry";
import { runWorkersAiChat, validateWorkersAiModel } from "@/lib/providers/workers-ai";
import { providerCapabilitiesRecord, ProviderError, type ProviderCredentialMode, type ProviderKind, type ProviderRequest, type ProviderTransportMode, type ProviderTypeId } from "@/lib/providers/types";

function normalized(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function inferProviderSlug(kind: ProviderKind, baseUrl: string) {
  if (kind !== "openai_compatible") return defaultProviderSlug(kind);
  const value = normalized(baseUrl).toLowerCase();
  if (/^https:\/\/bedrock-mantle\.[a-z0-9-]+\.api\.aws\/v1$/i.test(value)) return "aws-bedrock-mantle";
  return providerPresets.find((preset) => (
    preset.provider === kind
    && preset.defaultBaseUrl
    && normalized(preset.defaultBaseUrl).toLowerCase() === value
  ))?.slug ?? "custom-openai-compatible";
}

export function getProviderAdapter(kind: ProviderKind, providerSlug?: string | null) {
  const preset = resolveProviderPreset({ provider: kind, providerSlug });
  if (kind === "openai") return providerAdapters.openai;
  if (kind === "anthropic") return providerAdapters.anthropic;
  if (kind === "gemini") return providerAdapters.gemini;
  return preset.apiStyle === "openai_responses"
    ? providerAdapters.openai
    : providerAdapters.openai_compatible;
}

export function defaultBaseUrl(kind: ProviderKind, providerSlug?: string | null) {
  const preset = resolveProviderPreset({ provider: kind, providerSlug });
  return preset.defaultBaseUrl || getProviderAdapter(kind, providerSlug).defaultBaseUrl;
}

function canUseManualModel(error: unknown) {
  return error instanceof ProviderError && new Set([
    "PROVIDER_ENDPOINT_NOT_FOUND",
    "MODELS_ENDPOINT_UNSUPPORTED",
    "PROVIDER_INVALID_RESPONSE",
    "PROVIDER_REQUEST_FAILED",
  ]).has(error.code);
}

export async function validateProvider(input: {
  provider: ProviderKind;
  providerTypeId?: ProviderTypeId;
  providerSlug?: string;
  apiKey?: string;
  baseUrl?: string;
  transportMode?: ProviderTransportMode;
  credentialMode?: ProviderCredentialMode;
  gatewayId?: string;
  keyAlias?: string;
  allowedModels?: string[];
  defaultModel?: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
  testModel?: string;
  manualModel?: string;
  requestId: string;
  organizationId?: string;
  signal?: AbortSignal;
}) {
  const providerTypeId = input.providerTypeId ?? defaultProviderTypeId(input.provider);
  const transportMode = input.transportMode ?? "direct";
  const credentialMode = input.credentialMode ?? "encrypted_byok";
  validateCredentialTransport({
    provider: input.provider,
    providerTypeId,
    transportMode,
    credentialMode,
    apiKey: input.apiKey,
    gatewayId: input.gatewayId,
    keyAlias: input.keyAlias,
  });
  providerRegistry.get(providerTypeId).validateConfig({
    providerTypeId,
    providerKind: input.provider,
    transportMode,
    baseUrl: input.baseUrl,
    gatewayId: input.gatewayId,
    keyAlias: input.keyAlias,
    defaultModel: input.defaultModel,
    allowedModels: input.allowedModels,
  });

  const selectedModel = input.testModel?.trim() || input.defaultModel?.trim() || input.manualModel?.trim();
  const configuredModels = [...new Set([
    ...(input.allowedModels ?? []),
    ...(input.manualModel ? [input.manualModel] : []),
    ...(input.defaultModel ? [input.defaultModel] : []),
    ...(input.testModel ? [input.testModel] : []),
  ].map((model) => model.trim()).filter(Boolean))];
  const stages: Array<{ stage: string; status: "passed" | "manual"; latencyMs?: number }> = [];
  const startedAt = performance.now();

  if (transportMode === "cloudflare_workers_ai") {
    if (!selectedModel) throw new ProviderError("MODEL_TEST_REQUIRED", "اختر نموذج Workers AI لاختبار الاتصال.", 400);
    configuredModels.forEach(validateWorkersAiModel);
    const testStartedAt = performance.now();
    await runWorkersAiChat({
      model: selectedModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0,
      maxOutputTokens: 16,
      gatewayId: input.gatewayId,
      skipCache: input.skipCache,
      cacheTtl: input.cacheTtl,
      collectLog: input.collectLog,
      requestId: input.requestId,
    });
    const latencyMs = Math.round(performance.now() - testStartedAt);
    stages.push({ stage: "workers_ai_binding_generation", status: "passed", latencyMs });
    return {
      providerSlug: "cloudflare-workers-ai",
      providerTypeId,
      transportMode,
      credentialMode,
      apiStyle: "workers_ai_binding",
      normalizedBaseUrl: "cloudflare:workers-ai",
      models: configuredModels,
      latencyMs: Math.round(performance.now() - startedAt),
      stages,
      modelTest: { model: selectedModel, latencyMs },
      capabilities: providerCapabilitiesRecord(providerRegistry.get(providerTypeId).getCapabilities()),
      baseUrlAdjusted: false,
    };
  }

  if (transportMode === "cloudflare_ai_gateway_rest") {
    if (!selectedModel) throw new ProviderError("MODEL_TEST_REQUIRED", "اختر نموذجًا لاختبار AI Gateway REST.", 400);
    validateCloudflareRestModel(input.provider, selectedModel);
    const testStartedAt = performance.now();
    await runCloudflareRestChat({
      gatewayId: input.gatewayId,
      model: selectedModel,
      providerKind: input.provider,
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0,
      maxOutputTokens: 16,
      skipCache: input.skipCache,
      cacheTtl: input.cacheTtl,
      collectLog: input.collectLog,
      requestId: input.requestId,
      signal: input.signal,
    });
    const latencyMs = Math.round(performance.now() - testStartedAt);
    stages.push({ stage: "cloudflare_rest_generation", status: "passed", latencyMs });
    return {
      providerSlug: "cloudflare-ai-gateway",
      providerTypeId,
      transportMode,
      credentialMode,
      apiStyle: "cloudflare_rest_chat",
      normalizedBaseUrl: input.baseUrl?.trim() || "https://api.cloudflare.com/client/v4/accounts/managed/ai/v1",
      models: configuredModels,
      latencyMs: Math.round(performance.now() - startedAt),
      stages,
      modelTest: { model: selectedModel, latencyMs },
      capabilities: providerCapabilitiesRecord(providerRegistry.get(providerTypeId).getCapabilities()),
      baseUrlAdjusted: false,
    };
  }

  const preset = resolveProviderPreset(input);
  const adapter = getProviderAdapter(input.provider, preset.slug);
  const requestedBaseUrl = input.baseUrl?.trim() || preset.defaultBaseUrl || adapter.defaultBaseUrl;
  if (!requestedBaseUrl) {
    throw new ProviderError("BASE_URL_REQUIRED", "أدخل Base URL صالحًا للمزود المخصص.", 400);
  }
  const baseUrl = canonicalizeProviderBaseUrl(input.provider, requestedBaseUrl);
  const manualModel = input.manualModel?.trim();
  const apiKey = credentialMode === "cloudflare_provider_key"
    ? "cloudflare-managed-provider-key"
    : input.apiKey?.trim() ?? "";

  let discovery: { normalizedBaseUrl: string; models: string[]; latencyMs: number };
  try {
    discovery = await adapter.discoverModels({
      apiKey,
      baseUrl,
      signal: input.signal,
      requestId: input.requestId,
      organizationId: input.organizationId,
      providerKind: input.provider,
      providerTypeId,
      transportMode,
      gatewayId: input.gatewayId,
      keyAlias: input.keyAlias,
      skipCache: input.skipCache,
      cacheTtl: input.cacheTtl,
      collectLog: input.collectLog,
    });
    stages.push({ stage: "url_dns_tls_credentials_models", status: "passed", latencyMs: discovery.latencyMs });
  } catch (error) {
    if (!manualModel || !preset.manualModelAllowed || !canUseManualModel(error)) throw error;
    const checked = await validateProviderBaseUrl(baseUrl);
    discovery = {
      normalizedBaseUrl: checked.normalizedUrl,
      models: [manualModel],
      latencyMs: Math.round(performance.now() - startedAt),
    };
    stages.push({ stage: "url_dns_tls_manual_model", status: "manual", latencyMs: discovery.latencyMs });
  }

  const mergedModels = [...new Set([...configuredModels, ...discovery.models])];
  discovery.models = mergedModels;
  let modelTest: { model: string; latencyMs: number } | undefined;
  if (selectedModel) {
    if (!discovery.models.includes(selectedModel)) {
      throw new ProviderError("MODEL_UNAVAILABLE", "النموذج المحدد غير موجود ضمن النماذج المتاحة للمفتاح.", 422, 404, false, undefined, {
        category: "model_unavailable",
        provider: providerTypeId,
        model: selectedModel,
        requestId: input.requestId,
      });
    }
    const testStartedAt = performance.now();
    await adapter.testModel({
      apiKey,
      baseUrl: discovery.normalizedBaseUrl,
      providerSlug: preset.slug,
      providerTypeId,
      transportMode,
      gatewayId: input.gatewayId,
      keyAlias: input.keyAlias,
      skipCache: input.skipCache,
      cacheTtl: input.cacheTtl,
      collectLog: input.collectLog,
      model: selectedModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0,
      maxOutputTokens: 16,
      requestId: input.requestId,
      signal: input.signal,
      organizationId: input.organizationId,
      providerKind: input.provider,
    });
    modelTest = { model: selectedModel, latencyMs: Math.round(performance.now() - testStartedAt) };
    stages.push({ stage: "model_generation", status: "passed", latencyMs: modelTest.latencyMs });
  }

  return {
    providerSlug: preset.slug,
    providerTypeId,
    transportMode,
    credentialMode,
    apiStyle: preset.apiStyle,
    normalizedBaseUrl: discovery.normalizedBaseUrl,
    models: discovery.models,
    latencyMs: Math.round(performance.now() - startedAt),
    stages,
    modelTest,
    capabilities: adapter.capabilities,
    baseUrlAdjusted: normalized(requestedBaseUrl) !== normalized(discovery.normalizedBaseUrl),
  };
}

export async function generateWithProvider(kind: ProviderKind, input: ProviderRequest) {
  const slug = input.providerSlug ?? inferProviderSlug(kind, input.baseUrl);
  const adapter = getProviderAdapter(kind, slug);
  try {
    return await adapter.generate({ ...input, providerSlug: slug, providerKind: kind });
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
    }
    throw adapter.normalizeError(error);
  }
}

export async function* streamWithProvider(kind: ProviderKind, input: ProviderRequest) {
  const slug = input.providerSlug ?? inferProviderSlug(kind, input.baseUrl);
  const adapter = getProviderAdapter(kind, slug);
  try {
    yield* adapter.stream({ ...input, providerSlug: slug, providerKind: kind });
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
    }
    throw adapter.normalizeError(error);
  }
}

export function providerPresetForConnection(kind: ProviderKind, baseUrl: string) {
  return getProviderPreset(inferProviderSlug(kind, baseUrl));
}
