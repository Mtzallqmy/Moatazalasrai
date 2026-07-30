import { providerAdapters } from "@/lib/providers/adapters";
import { canonicalizeProviderBaseUrl } from "@/lib/providers/base-url";
import { ProviderError, type ProviderKind, type ProviderRequest } from "@/lib/providers/types";

export function getProviderAdapter(kind: ProviderKind) {
  return providerAdapters[kind];
}

export function defaultBaseUrl(kind: ProviderKind) {
  return getProviderAdapter(kind).defaultBaseUrl;
}

export async function validateProvider(input: {
  provider: ProviderKind;
  apiKey: string;
  baseUrl?: string;
  testModel?: string;
  requestId: string;
  signal?: AbortSignal;
}) {
  const adapter = getProviderAdapter(input.provider);
  const requestedBaseUrl = input.baseUrl?.trim() || adapter.defaultBaseUrl;
  const baseUrl = canonicalizeProviderBaseUrl(input.provider, requestedBaseUrl);
  const stages: Array<{ stage: string; status: "passed"; latencyMs?: number }> = [];
  const startedAt = performance.now();
  const discovery = await adapter.discoverModels({
    apiKey: input.apiKey,
    baseUrl,
    signal: input.signal,
    requestId: input.requestId,
  });
  stages.push({ stage: "url_dns_tls_credentials_models", status: "passed", latencyMs: discovery.latencyMs });
  let modelTest: { model: string; latencyMs: number } | undefined;
  if (input.testModel) {
    if (!discovery.models.includes(input.testModel)) {
      throw new ProviderError("MODEL_UNAVAILABLE", "النموذج المحدد غير موجود ضمن النماذج المتاحة للمفتاح.", 422);
    }
    const testStartedAt = performance.now();
    await adapter.testModel({
      apiKey: input.apiKey,
      baseUrl: discovery.normalizedBaseUrl,
      model: input.testModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0,
      maxOutputTokens: 16,
      requestId: input.requestId,
      signal: input.signal,
    });
    modelTest = { model: input.testModel, latencyMs: Math.round(performance.now() - testStartedAt) };
    stages.push({ stage: "model_generation", status: "passed", latencyMs: modelTest.latencyMs });
  }
  return {
    normalizedBaseUrl: discovery.normalizedBaseUrl,
    models: discovery.models,
    latencyMs: Math.round(performance.now() - startedAt),
    stages,
    modelTest,
    baseUrlAdjusted: requestedBaseUrl.replace(/\/+$/, "") !== discovery.normalizedBaseUrl.replace(/\/+$/, ""),
  };
}

export async function generateWithProvider(kind: ProviderKind, input: ProviderRequest) {
  const adapter = getProviderAdapter(kind);
  try {
    return await adapter.generate(input);
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
    }
    throw adapter.normalizeError(error);
  }
}

export async function* streamWithProvider(kind: ProviderKind, input: ProviderRequest) {
  const adapter = getProviderAdapter(kind);
  try {
    yield* adapter.stream(input);
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
    }
    throw adapter.normalizeError(error);
  }
}
