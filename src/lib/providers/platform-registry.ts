import { providerAdapters } from "@/lib/providers/adapters";
import { runCloudflareRestChat, streamCloudflareRestChat, validateCloudflareRestModel } from "@/lib/providers/cloudflare-rest";
import { normalizeUnknownProviderError } from "@/lib/providers/errors";
import { resolveProviderPreset } from "@/lib/providers/catalog";
import {
  ProviderError,
  type DiscoveryResult,
  type ProviderCapabilities,
  type ProviderHealthStatus,
  type ProviderKind,
  type ProviderRequest,
  type ProviderResult,
  type ProviderStreamChunk,
  type ProviderTransportMode,
  type ProviderTypeId,
} from "@/lib/providers/types";
import { runWorkersAiChat, streamWorkersAiChat, validateWorkersAiModel, workersAiCapabilities } from "@/lib/providers/workers-ai";


function getServerAdapter(kind: ProviderKind, providerSlug?: string) {
  const preset = resolveProviderPreset({ provider: kind, providerSlug });
  if (kind === "openai") return providerAdapters.openai;
  if (kind === "anthropic") return providerAdapters.anthropic;
  if (kind === "gemini") return providerAdapters.gemini;
  return preset.apiStyle === "openai_responses" ? providerAdapters.openai : providerAdapters.openai_compatible;
}

function serverDefaultBaseUrl(kind: ProviderKind, providerSlug?: string) {
  const preset = resolveProviderPreset({ provider: kind, providerSlug });
  return preset.defaultBaseUrl || getServerAdapter(kind, providerSlug).defaultBaseUrl;
}

export type ProviderConfigInput = {
  providerTypeId: ProviderTypeId;
  providerKind?: ProviderKind;
  transportMode: ProviderTransportMode;
  baseUrl?: string;
  gatewayId?: string;
  keyAlias?: string;
  defaultModel?: string;
  allowedModels?: string[];
};

export type UnifiedProviderAdapter = {
  id: ProviderTypeId;
  validateConfig(config: ProviderConfigInput): void;
  testConnection(input: ProviderRequest): Promise<ProviderResult>;
  listModels(input: ProviderRequest): Promise<DiscoveryResult>;
  sendChat(input: ProviderRequest): Promise<ProviderResult>;
  streamChat(input: ProviderRequest): AsyncGenerator<ProviderStreamChunk>;
  normalizeError(error: unknown, input?: Pick<ProviderRequest, "model" | "requestId">): ProviderError;
  getCapabilities(): ProviderCapabilities;
  getHealthStatus(error?: ProviderError): ProviderHealthStatus;
};

function typeIdForKind(kind: ProviderKind): ProviderTypeId {
  if (kind === "openai") return "openai";
  if (kind === "anthropic") return "anthropic";
  if (kind === "gemini") return "google-ai-studio";
  return "custom-openai-compatible";
}

function kindForTypeId(id: ProviderTypeId, configured?: ProviderKind): ProviderKind {
  if (configured) return configured;
  if (id === "openai") return "openai";
  if (id === "anthropic") return "anthropic";
  if (id === "google-ai-studio") return "gemini";
  if (id === "custom-openai-compatible") return "openai_compatible";
  throw new ProviderError(
    "PROVIDER_CONFIG_INVALID",
    "يتطلب إعداد Cloudflare تحديد المزود الهدف.",
    422,
    undefined,
    false,
    undefined,
    { category: "misconfigured", provider: id },
  );
}

function health(error?: ProviderError): ProviderHealthStatus {
  if (!error) return "healthy";
  switch (error.category) {
    case "authentication":
    case "authorization": return "unauthorized";
    case "model_unavailable": return "model_unavailable";
    case "rate_limit":
    case "quota": return "rate_limited";
    case "network":
    case "timeout": return "network_error";
    case "misconfigured":
    case "invalid_request": return "misconfigured";
    case "provider_unavailable":
    case "malformed_response":
    case "empty_response":
    case "stream_interrupted": return "degraded";
    default: return "unknown";
  }
}

function serverAdapter(id: ProviderTypeId, forcedMode?: ProviderTransportMode): UnifiedProviderAdapter {
  return {
    id,
    validateConfig(config) {
      const kind = kindForTypeId(id, config.providerKind);
      const mode = forcedMode ?? config.transportMode;
      if (mode === "cloudflare_workers_ai" || mode === "cloudflare_ai_gateway_rest") {
        throw new ProviderError("PROVIDER_CONFIG_INVALID", "نوع النقل لا يطابق هذا المزوّد.", 422, undefined, false, undefined, {
          category: "misconfigured",
          provider: id,
        });
      }
      const baseUrl = config.baseUrl?.trim() || serverDefaultBaseUrl(kind);
      if (!baseUrl) throw new ProviderError("BASE_URL_REQUIRED", "أدخل Base URL صالحًا.", 400);
      if (mode === "cloudflare_ai_gateway_native" && kind === "openai_compatible") {
        throw new ProviderError("PROVIDER_CONFIG_INVALID", "المزوّد المخصص لا يمر عبر مسار Cloudflare الأصلي تلقائيًا.", 422);
      }
    },
    testConnection(input) {
      const kind = kindForTypeId(id, input.providerKind);
      return getServerAdapter(kind, input.providerSlug).testModel({ ...input, transportMode: forcedMode ?? input.transportMode });
    },
    listModels(input) {
      const kind = kindForTypeId(id, input.providerKind);
      return getServerAdapter(kind, input.providerSlug).discoverModels({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        signal: input.signal,
        requestId: input.requestId,
        organizationId: input.organizationId,
        providerKind: kind,
        providerTypeId: id,
        transportMode: forcedMode ?? input.transportMode,
        gatewayId: input.gatewayId,
        keyAlias: input.keyAlias,
        skipCache: input.skipCache,
        cacheTtl: input.cacheTtl,
        collectLog: input.collectLog,
      });
    },
    sendChat(input) {
      const kind = kindForTypeId(id, input.providerKind);
      return getServerAdapter(kind, input.providerSlug).generate({ ...input, providerKind: kind, transportMode: forcedMode ?? input.transportMode });
    },
    streamChat(input) {
      const kind = kindForTypeId(id, input.providerKind);
      return getServerAdapter(kind, input.providerSlug).stream({ ...input, providerKind: kind, transportMode: forcedMode ?? input.transportMode });
    },
    normalizeError(error, input) {
      return normalizeUnknownProviderError(error, { provider: id, model: input?.model, requestId: input?.requestId });
    },
    getCapabilities() {
      const kind = kindForTypeId(id, id === "cloudflare-ai-gateway" ? "openai" : undefined);
      return getServerAdapter(kind).capabilities;
    },
    getHealthStatus: health,
  };
}

const cloudflareGatewayCapabilities: ProviderCapabilities = {
  streaming: true,
  systemMessages: true,
  configurableTemperature: true,
  maxOutputTokens: true,
  modelDiscovery: false,
  serverExecution: true,
  backgroundExecution: true,
  tools: false,
};

function cloudflareGatewayMode(input: { transportMode?: ProviderTransportMode }) {
  const mode = input.transportMode ?? "cloudflare_ai_gateway_native";
  if (mode !== "cloudflare_ai_gateway_native" && mode !== "cloudflare_ai_gateway_rest") {
    throw new ProviderError(
      "PROVIDER_CONFIG_INVALID",
      "Cloudflare AI Gateway يتطلب مسار provider-native أو REST API.",
      422,
      undefined,
      false,
      undefined,
      { category: "misconfigured", provider: "cloudflare-ai-gateway" },
    );
  }
  return mode;
}

const cloudflareGatewayAdapter: UnifiedProviderAdapter = {
  id: "cloudflare-ai-gateway",
  validateConfig(config) {
    const mode = cloudflareGatewayMode(config);
    const kind = kindForTypeId("cloudflare-ai-gateway", config.providerKind);
    if (!config.gatewayId?.trim() && !process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim()) {
      throw new ProviderError("PROVIDER_CONFIG_INVALID", "معرف Cloudflare AI Gateway مطلوب.", 422, undefined, false, undefined, {
        category: "misconfigured",
        provider: "cloudflare-ai-gateway",
      });
    }
    if (kind === "openai_compatible") {
      throw new ProviderError(
        "PROVIDER_CONFIG_INVALID",
        "المزوّد المخصص لا يُوجّه تلقائيًا عبر Cloudflare AI Gateway.",
        422,
        undefined,
        false,
        undefined,
        { category: "misconfigured", provider: "cloudflare-ai-gateway" },
      );
    }
    if (mode === "cloudflare_ai_gateway_rest") {
      if (config.defaultModel) validateCloudflareRestModel(kind, config.defaultModel);
      for (const model of config.allowedModels ?? []) validateCloudflareRestModel(kind, model);
      return;
    }
    serverAdapter("cloudflare-ai-gateway", "cloudflare_ai_gateway_native").validateConfig({ ...config, providerKind: kind });
  },
  testConnection(input) {
    const mode = cloudflareGatewayMode(input);
    const kind = kindForTypeId("cloudflare-ai-gateway", input.providerKind);
    if (mode === "cloudflare_ai_gateway_rest") {
      return runCloudflareRestChat({ ...input, providerKind: kind });
    }
    return serverAdapter("cloudflare-ai-gateway", "cloudflare_ai_gateway_native").testConnection({ ...input, providerKind: kind });
  },
  async listModels(input) {
    const startedAt = Date.now();
    const mode = cloudflareGatewayMode(input);
    const kind = kindForTypeId("cloudflare-ai-gateway", input.providerKind);
    if (mode === "cloudflare_ai_gateway_rest") {
      const model = validateCloudflareRestModel(kind, input.model);
      return { normalizedBaseUrl: "cloudflare:ai-gateway-rest", models: [model], latencyMs: Date.now() - startedAt };
    }
    return serverAdapter("cloudflare-ai-gateway", "cloudflare_ai_gateway_native").listModels({ ...input, providerKind: kind });
  },
  sendChat(input) {
    const mode = cloudflareGatewayMode(input);
    const kind = kindForTypeId("cloudflare-ai-gateway", input.providerKind);
    if (mode === "cloudflare_ai_gateway_rest") return runCloudflareRestChat({ ...input, providerKind: kind });
    return serverAdapter("cloudflare-ai-gateway", "cloudflare_ai_gateway_native").sendChat({ ...input, providerKind: kind });
  },
  streamChat(input) {
    const mode = cloudflareGatewayMode(input);
    const kind = kindForTypeId("cloudflare-ai-gateway", input.providerKind);
    if (mode === "cloudflare_ai_gateway_rest") return streamCloudflareRestChat({ ...input, providerKind: kind });
    return serverAdapter("cloudflare-ai-gateway", "cloudflare_ai_gateway_native").streamChat({ ...input, providerKind: kind });
  },
  normalizeError(error, input) {
    return normalizeUnknownProviderError(error, { provider: "cloudflare-ai-gateway", model: input?.model, requestId: input?.requestId });
  },
  getCapabilities: () => cloudflareGatewayCapabilities,
  getHealthStatus: health,
};

const workersAdapter: UnifiedProviderAdapter = {
  id: "cloudflare-workers-ai",
  validateConfig(config) {
    if (config.transportMode !== "cloudflare_workers_ai") {
      throw new ProviderError("PROVIDER_CONFIG_INVALID", "Workers AI يتطلب transportMode المخصص له.", 422);
    }
    if (config.defaultModel) validateWorkersAiModel(config.defaultModel);
  },
  testConnection(input) {
    return runWorkersAiChat(input);
  },
  async listModels(input) {
    const models = [...new Set((input.model ? [input.model] : []).filter(Boolean))];
    models.forEach(validateWorkersAiModel);
    return { normalizedBaseUrl: "cloudflare:workers-ai", models, latencyMs: 0 };
  },
  sendChat(input) {
    return runWorkersAiChat(input);
  },
  streamChat(input) {
    return streamWorkersAiChat(input);
  },
  normalizeError(error, input) {
    return normalizeUnknownProviderError(error, { provider: "cloudflare-workers-ai", model: input?.model, requestId: input?.requestId });
  },
  getCapabilities: () => workersAiCapabilities,
  getHealthStatus: health,
};

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderTypeId, UnifiedProviderAdapter>([
    ["openai", serverAdapter("openai")],
    ["anthropic", serverAdapter("anthropic")],
    ["google-ai-studio", serverAdapter("google-ai-studio")],
    ["custom-openai-compatible", serverAdapter("custom-openai-compatible")],
    ["cloudflare-ai-gateway", cloudflareGatewayAdapter],
    ["cloudflare-workers-ai", workersAdapter],
  ]);

  get(id: ProviderTypeId) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new ProviderError("PROVIDER_CONFIG_INVALID", "معرف المزود غير مسجل.", 422);
    return adapter;
  }

  list() {
    return [...this.adapters.values()].map((adapter) => ({ id: adapter.id, capabilities: adapter.getCapabilities() }));
  }
}

export class ProviderRequestRouter {
  constructor(private readonly registry = new ProviderRegistry()) {}

  send(providerId: ProviderTypeId, input: ProviderRequest) {
    return this.registry.get(providerId).sendChat(input);
  }

  stream(providerId: ProviderTypeId, input: ProviderRequest) {
    return this.registry.get(providerId).streamChat(input);
  }
}

export const providerRegistry = new ProviderRegistry();
export const providerRequestRouter = new ProviderRequestRouter(providerRegistry);

export const existingServerProviderIds = Object.freeze(
  (Object.keys(providerAdapters) as ProviderKind[]).map(typeIdForKind),
);
