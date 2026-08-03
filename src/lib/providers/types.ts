export type ProviderKind = "openai" | "anthropic" | "gemini" | "openai_compatible";

/** Stable public identifiers. ProviderKind remains unchanged for DB/API compatibility. */
export type ProviderTypeId =
  | "cloudflare-workers-ai"
  | "cloudflare-ai-gateway"
  | "openai"
  | "anthropic"
  | "google-ai-studio"
  | "custom-openai-compatible";

export type ProviderTransportMode =
  | "direct"
  | "cloudflare_ai_gateway_native"
  | "cloudflare_ai_gateway_rest"
  | "cloudflare_workers_ai";

export type ProviderCredentialMode = "encrypted_byok" | "cloudflare_provider_key" | "cloudflare_binding";

export type ProviderHealthStatus =
  | "unconfigured"
  | "validating"
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "unauthorized"
  | "model_unavailable"
  | "network_error"
  | "misconfigured"
  | "disabled"
  | "unknown";

export type ProviderErrorCategory =
  | "authentication"
  | "authorization"
  | "model_unavailable"
  | "rate_limit"
  | "quota"
  | "timeout"
  | "network"
  | "provider_unavailable"
  | "invalid_request"
  | "malformed_response"
  | "empty_response"
  | "stream_interrupted"
  | "misconfigured"
  | "cancelled"
  | "unknown";

export type ProviderContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string | ProviderContentPart[] };

export type ProviderRequest = {
  apiKey: string;
  baseUrl: string;
  providerSlug?: string;
  model: string;
  messages: ProviderMessage[];
  temperature: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
  requestId: string;
  organizationId?: string;
  providerKind?: ProviderKind;
  providerTypeId?: ProviderTypeId;
  transportMode?: ProviderTransportMode;
  gatewayId?: string;
  keyAlias?: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
};

export type ProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ProviderResult = ProviderUsage & {
  text: string;
  providerRequestId?: string;
};

export type ProviderStreamChunk =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: ProviderUsage; providerRequestId?: string }
  | { type: "done"; providerRequestId?: string };

export type ProviderCapabilities = {
  streaming: boolean;
  systemMessages: boolean;
  configurableTemperature: boolean;
  maxOutputTokens: boolean;
  modelDiscovery?: boolean;
  serverExecution?: boolean;
  backgroundExecution?: boolean;
  tools?: boolean;
};

export function providerCapabilitiesRecord(capabilities: ProviderCapabilities): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(capabilities).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
}

export type DiscoveryResult = {
  normalizedBaseUrl: string;
  models: string[];
  latencyMs: number;
};

export type ProviderAdapter = {
  kind: ProviderKind;
  defaultBaseUrl: string;
  capabilities: ProviderCapabilities;
  discoverModels(input: {
    apiKey: string;
    baseUrl: string;
    signal?: AbortSignal;
    requestId: string;
    organizationId?: string;
    providerKind?: ProviderKind;
    providerTypeId?: ProviderTypeId;
    transportMode?: ProviderTransportMode;
    gatewayId?: string;
    keyAlias?: string;
    skipCache?: boolean;
    cacheTtl?: number;
    collectLog?: boolean;
  }): Promise<DiscoveryResult>;
  testModel(input: ProviderRequest): Promise<ProviderResult>;
  generate(input: ProviderRequest): Promise<ProviderResult>;
  stream(input: ProviderRequest): AsyncGenerator<ProviderStreamChunk>;
  normalizeError(error: unknown): ProviderError;
  normalizeUsage(input: unknown): ProviderUsage;
  abort(): AbortController;
};

export type ProviderDiagnostic = {
  category: ProviderErrorCategory;
  code: string;
  provider?: ProviderTypeId | ProviderKind;
  model?: string;
  httpStatus: number;
  providerStatus?: number;
  retryable: boolean;
  userMessage: string;
  technicalMessage: string;
  requestId?: string;
  providerRequestId?: string;
  timestamp: string;
};

export class ProviderError extends Error {
  public readonly category: ProviderErrorCategory;
  public readonly provider?: ProviderTypeId | ProviderKind;
  public readonly model?: string;
  public readonly requestId?: string;
  public readonly providerRequestId?: string;
  public readonly technicalMessage: string;
  public readonly timestamp: string;

  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly providerStatus?: number,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
    context: {
      category?: ProviderErrorCategory;
      provider?: ProviderTypeId | ProviderKind;
      model?: string;
      requestId?: string;
      providerRequestId?: string;
      technicalMessage?: string;
      timestamp?: string;
    } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.category = context.category ?? "unknown";
    this.provider = context.provider;
    this.model = context.model;
    this.requestId = context.requestId;
    this.providerRequestId = context.providerRequestId;
    this.technicalMessage = context.technicalMessage ?? code;
    this.timestamp = context.timestamp ?? new Date().toISOString();
  }

  diagnostic(): ProviderDiagnostic {
    return {
      category: this.category,
      code: this.code,
      provider: this.provider,
      model: this.model,
      httpStatus: this.httpStatus,
      providerStatus: this.providerStatus,
      retryable: this.retryable,
      userMessage: this.message,
      technicalMessage: this.technicalMessage,
      requestId: this.requestId,
      providerRequestId: this.providerRequestId,
      timestamp: this.timestamp,
    };
  }
}
