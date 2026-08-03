import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderKind, ProviderTransportMode, ProviderTypeId } from "@/lib/providers/types";
import { llmGateway } from "@/lib/providers/llm-gateway";

export type ModelInput = {
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
  organizationId?: string;
  requestId?: string;
  providerTypeId?: ProviderTypeId;
  transportMode?: ProviderTransportMode;
  gatewayId?: string;
  keyAlias?: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
};

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function createDirectLanguageModel(input: ModelInput) {
  const transport = llmGateway.resolve({
    provider: input.provider,
    directBaseUrl: normalizedBaseUrl(input.baseUrl),
    organizationId: input.organizationId,
    requestId: input.requestId,
    transportMode: input.transportMode,
    gatewayId: input.gatewayId,
    keyAlias: input.keyAlias,
    skipCache: input.skipCache,
    cacheTtl: input.cacheTtl,
    collectLog: input.collectLog,
  });
  const baseURL = transport.baseUrl;
  if (!input.apiKey) throw new Error("AI_SDK_API_KEY_REQUIRED");
  if (!input.model.trim()) throw new Error("AI_SDK_MODEL_REQUIRED");

  if (input.provider === "openai") {
    return createOpenAI({ apiKey: input.apiKey, baseURL, headers: transport.headers, fetch: transport.fetch })(input.model);
  }
  if (input.provider === "anthropic") {
    return createAnthropic({ apiKey: input.apiKey, baseURL, headers: transport.headers, fetch: transport.fetch })(input.model);
  }
  if (input.provider === "gemini") {
    return createGoogleGenerativeAI({ apiKey: input.apiKey, baseURL, headers: transport.headers, fetch: transport.fetch })(input.model);
  }
  return createOpenAICompatible({
    name: "organization-openai-compatible",
    apiKey: input.apiKey,
    baseURL,
    headers: transport.headers,
    fetch: transport.fetch,
  })(input.model);
}
