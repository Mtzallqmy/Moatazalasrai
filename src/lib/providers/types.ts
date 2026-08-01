export type ProviderKind = "openai" | "anthropic" | "gemini" | "openai_compatible";
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
};

export type DiscoveryResult = {
  normalizedBaseUrl: string;
  models: string[];
  latencyMs: number;
};

export type ProviderAdapter = {
  kind: ProviderKind;
  defaultBaseUrl: string;
  capabilities: ProviderCapabilities;
  discoverModels(input: { apiKey: string; baseUrl: string; signal?: AbortSignal; requestId: string; organizationId?: string; providerKind?: ProviderKind }): Promise<DiscoveryResult>;
  testModel(input: ProviderRequest): Promise<ProviderResult>;
  generate(input: ProviderRequest): Promise<ProviderResult>;
  stream(input: ProviderRequest): AsyncGenerator<ProviderStreamChunk>;
  normalizeError(error: unknown): ProviderError;
  normalizeUsage(input: unknown): ProviderUsage;
  abort(): AbortController;
};

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly providerStatus?: number,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
