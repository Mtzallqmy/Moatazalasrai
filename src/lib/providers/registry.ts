import { providerAdapters } from "@/lib/providers/adapters";
import { canonicalizeProviderBaseUrl } from "@/lib/providers/base-url";
import {
  defaultProviderSlug,
  getProviderPreset,
  providerPresets,
  resolveProviderPreset,
} from "@/lib/providers/catalog";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";
import { ProviderError, type ProviderKind, type ProviderRequest } from "@/lib/providers/types";

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
  providerSlug?: string;
  apiKey: string;
  baseUrl?: string;
  testModel?: string;
  manualModel?: string;
  requestId: string;
  signal?: AbortSignal;
}) {
  const preset = resolveProviderPreset(input);
  const adapter = getProviderAdapter(input.provider, preset.slug);
  const requestedBaseUrl = input.baseUrl?.trim() || preset.defaultBaseUrl || adapter.defaultBaseUrl;
  if (!requestedBaseUrl) {
    throw new ProviderError("BASE_URL_REQUIRED", "أدخل Base URL صالحًا للمزود المخصص.", 400);
  }
  const baseUrl = canonicalizeProviderBaseUrl(input.provider, requestedBaseUrl);
  const manualModel = input.manualModel?.trim();
  const stages: Array<{ stage: string; status: "passed" | "manual"; latencyMs?: number }> = [];
  const startedAt = performance.now();

  let discovery: { normalizedBaseUrl: string; models: string[]; latencyMs: number };
  try {
    discovery = await adapter.discoverModels({
      apiKey: input.apiKey,
      baseUrl,
      signal: input.signal,
      requestId: input.requestId,
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

  if (manualModel && !discovery.models.includes(manualModel)) {
    discovery.models = [...new Set([manualModel, ...discovery.models])];
  }

  const selectedModel = input.testModel?.trim() || manualModel;
  let modelTest: { model: string; latencyMs: number } | undefined;
  if (selectedModel) {
    if (!discovery.models.includes(selectedModel)) {
      throw new ProviderError("MODEL_UNAVAILABLE", "النموذج المحدد غير موجود ضمن النماذج المتاحة للمفتاح.", 422);
    }
    const testStartedAt = performance.now();
    await adapter.testModel({
      apiKey: input.apiKey,
      baseUrl: discovery.normalizedBaseUrl,
      providerSlug: preset.slug,
      model: selectedModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0,
      maxOutputTokens: 16,
      requestId: input.requestId,
      signal: input.signal,
    });
    modelTest = { model: selectedModel, latencyMs: Math.round(performance.now() - testStartedAt) };
    stages.push({ stage: "model_generation", status: "passed", latencyMs: modelTest.latencyMs });
  }

  return {
    providerSlug: preset.slug,
    apiStyle: preset.apiStyle,
    normalizedBaseUrl: discovery.normalizedBaseUrl,
    models: discovery.models,
    latencyMs: Math.round(performance.now() - startedAt),
    stages,
    modelTest,
    baseUrlAdjusted: normalized(requestedBaseUrl) !== normalized(discovery.normalizedBaseUrl),
  };
}

export async function generateWithProvider(kind: ProviderKind, input: ProviderRequest) {
  const slug = input.providerSlug ?? inferProviderSlug(kind, input.baseUrl);
  const adapter = getProviderAdapter(kind, slug);
  try {
    return await adapter.generate({ ...input, providerSlug: slug });
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
    yield* adapter.stream({ ...input, providerSlug: slug });
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
