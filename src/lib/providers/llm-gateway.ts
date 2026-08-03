import { createHash } from "node:crypto";
import { gatewayControlHeaders, providerNativeGatewayBaseUrl } from "@/lib/providers/cloudflare-endpoints";
import { normalizeUnknownProviderError } from "@/lib/providers/errors";
import { providerErrorForHttpStatus } from "@/lib/providers/http";
import { ProviderError, type ProviderKind, type ProviderTransportMode } from "@/lib/providers/types";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

const DEFAULT_TIMEOUT_MS = 60_000;
const EXPLICIT_FALLBACK_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

type SafeLogEntry = {
  event: "llm_gateway_request";
  provider: ProviderKind;
  organizationId?: string;
  duration: number;
  statusCode: number | null;
  requestId?: string;
  route: "gateway" | "direct_fallback";
  fallbackPolicy: "disabled" | "explicit_transient_only";
};

type GatewayDependencies = {
  fetch?: typeof globalThis.fetch;
  validateUrl?: (url: string) => Promise<unknown>;
  now?: () => number;
  log?: (entry: SafeLogEntry) => void;
};

export type LLMGatewayTransport = {
  baseUrl: string;
  configuredUrl?: string;
  headers: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  gateway: boolean;
};

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function normalized(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function hashedOrganizationId(value: string | undefined) {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 24) : undefined;
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.toString() : String(input);
}

function replaceBaseUrl(url: string, sourceBase: string, targetBase: string) {
  const source = normalized(sourceBase);
  if (!url.startsWith(source)) {
    throw new ProviderError(
      "PROVIDER_CONFIG_INVALID",
      "تعذر مطابقة مسار Cloudflare AI Gateway مع مسار المزود.",
      500,
      undefined,
      false,
      undefined,
      { category: "misconfigured", technicalMessage: "Gateway request URL is outside configured base URL" },
    );
  }
  return `${normalized(targetBase)}${url.slice(source.length)}`;
}

function replayableBody(body: ArrayBuffer, method: string) {
  return method === "GET" || method === "HEAD" ? undefined : body;
}

function gatewayToken() {
  return process.env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim()
    || process.env.CLOUDFLARE_API_TOKEN?.trim()
    || undefined;
}

function removeProviderCredentialHeaders(headers: Headers, provider: ProviderKind) {
  if (provider === "openai") headers.delete("authorization");
  if (provider === "anthropic") headers.delete("x-api-key");
  if (provider === "gemini") headers.delete("x-goog-api-key");
}

function removeGatewayHeaders(headers: Headers) {
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("cf-aig-")) headers.delete(name);
  }
}

function explicitFallbackEnabled() {
  return enabled(process.env.AI_PROVIDER_FALLBACK_ENABLED)
    && enabled(process.env.AI_PROVIDER_DIRECT_FALLBACK_ENABLED);
}

function fallbackAllowed(error: ProviderError) {
  if (!error.retryable) return false;
  if (error.category === "network" || error.category === "timeout") return true;
  return error.providerStatus !== undefined && EXPLICIT_FALLBACK_STATUSES.has(error.providerStatus);
}

export class LLMGateway {
  constructor(private readonly dependencies: GatewayDependencies = {}) {}

  status() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
    return {
      enabled: enabled(process.env.CLOUDFLARE_AI_GATEWAY_ENABLED),
      accountIdConfigured: Boolean(accountId),
      gatewayIdConfigured: Boolean(gatewayId),
      authenticated: Boolean(gatewayToken()),
      fallbackPolicy: explicitFallbackEnabled() ? "explicit_transient_only" as const : "disabled" as const,
      gatewayId,
    };
  }

  resolve(input: {
    provider: ProviderKind;
    directBaseUrl: string;
    organizationId?: string;
    requestId?: string;
    transportMode?: ProviderTransportMode;
    gatewayId?: string;
    keyAlias?: string;
    skipCache?: boolean;
    cacheTtl?: number;
    collectLog?: boolean;
  }): LLMGatewayTransport {
    const directBaseUrl = normalized(input.directBaseUrl);
    const mode = input.transportMode
      ?? (this.status().enabled && input.provider !== "openai_compatible" ? "cloudflare_ai_gateway_native" : "direct");
    if (mode === "direct") return { baseUrl: directBaseUrl, headers: {}, gateway: false };
    if (mode !== "cloudflare_ai_gateway_native") {
      throw new ProviderError(
        "PROVIDER_CONFIG_INVALID",
        "مسار النقل المختار لا يطابق adapter المزوّد الحالي.",
        422,
        undefined,
        false,
        undefined,
        { category: "misconfigured", provider: input.provider, requestId: input.requestId },
      );
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const gatewayId = input.gatewayId?.trim() || process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
    if (!accountId || !gatewayId) {
      throw new ProviderError(
        "PROVIDER_CONFIG_INVALID",
        "إعدادات حساب أو بوابة Cloudflare غير مكتملة.",
        422,
        undefined,
        false,
        undefined,
        { category: "misconfigured", provider: input.provider, requestId: input.requestId },
      );
    }
    const gatewayBaseUrl = providerNativeGatewayBaseUrl({ accountId, gatewayId, provider: input.provider });
    const headers = gatewayControlHeaders({
      gatewayToken: gatewayToken(),
      keyAlias: input.keyAlias,
      skipCache: input.skipCache,
      cacheTtl: input.cacheTtl,
      collectLog: input.collectLog,
    });
    return {
      baseUrl: gatewayBaseUrl,
      configuredUrl: gatewayBaseUrl,
      headers,
      gateway: true,
      fetch: this.createGatewayFetch({
        ...input,
        directBaseUrl,
        gatewayBaseUrl,
        headers,
        useStoredProviderKey: Boolean(input.keyAlias),
      }),
    };
  }

  async reachability(provider: ProviderKind = "openai") {
    const status = this.status();
    if (!status.enabled) return { enabled: false, reachable: false, reason: "disabled" as const };
    try {
      const transport = this.resolve({
        provider,
        directBaseUrl: provider === "anthropic"
          ? "https://api.anthropic.com"
          : provider === "gemini"
            ? "https://generativelanguage.googleapis.com/v1beta"
            : "https://api.openai.com/v1",
        requestId: crypto.randomUUID(),
      });
      const response = await this.fetchImpl()(transport.baseUrl, {
        method: "HEAD",
        headers: transport.headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel().catch(() => undefined);
      return { enabled: true, reachable: true, statusCode: response.status, gatewayUrl: transport.baseUrl };
    } catch (error) {
      const normalizedError = normalizeUnknownProviderError(error, { provider });
      return {
        enabled: true,
        reachable: false,
        errorCode: normalizedError.code,
        category: normalizedError.category,
      };
    }
  }

  private createGatewayFetch(input: {
    provider: ProviderKind;
    directBaseUrl: string;
    gatewayBaseUrl: string;
    headers: Record<string, string>;
    organizationId?: string;
    requestId?: string;
    useStoredProviderKey: boolean;
  }): typeof globalThis.fetch {
    return async (requestInput, requestInit) => {
      const source = new Request(requestInput, requestInit);
      const body = await source.clone().arrayBuffer();
      const gatewayUrl = requestUrl(source);
      try {
        const response = await this.attempt({
          url: gatewayUrl,
          source,
          body,
          provider: input.provider,
          organizationId: input.organizationId,
          requestId: input.requestId,
          route: "gateway",
          gatewayHeaders: input.headers,
          removeProviderCredentials: input.useStoredProviderKey,
        });
        if (input.useStoredProviderKey || !explicitFallbackEnabled() || !EXPLICIT_FALLBACK_STATUSES.has(response.status)) return response;
        const responseText = await response.clone().text().catch(() => "");
        const gatewayError = providerErrorForHttpStatus(response.status, responseText, response.headers);
        if (!fallbackAllowed(gatewayError)) return response;
        await response.body?.cancel().catch(() => undefined);
        return this.directFallback({ ...input, source, body, gatewayUrl });
      } catch (error) {
        const normalizedError = normalizeUnknownProviderError(error, {
          provider: input.provider,
          requestId: input.requestId,
        });
        if (input.useStoredProviderKey || !explicitFallbackEnabled() || !fallbackAllowed(normalizedError) || source.signal.aborted) throw normalizedError;
        return this.directFallback({ ...input, source, body, gatewayUrl });
      }
    };
  }

  private directFallback(input: {
    provider: ProviderKind;
    directBaseUrl: string;
    gatewayBaseUrl: string;
    organizationId?: string;
    requestId?: string;
    source: Request;
    body: ArrayBuffer;
    gatewayUrl: string;
  }) {
    const directUrl = replaceBaseUrl(input.gatewayUrl, input.gatewayBaseUrl, input.directBaseUrl);
    return this.attempt({
      url: directUrl,
      source: input.source,
      body: input.body,
      provider: input.provider,
      organizationId: input.organizationId,
      requestId: input.requestId,
      route: "direct_fallback",
    });
  }

  private async attempt(input: {
    url: string;
    source: Request;
    body: ArrayBuffer;
    provider: ProviderKind;
    organizationId?: string;
    requestId?: string;
    route: "gateway" | "direct_fallback";
    gatewayHeaders?: Record<string, string>;
    removeProviderCredentials?: boolean;
  }) {
    const started = this.now();
    let statusCode: number | null = null;
    try {
      await (this.dependencies.validateUrl ?? validateProviderBaseUrl)(input.url);
      const headers = new Headers(input.source.headers);
      if (input.gatewayHeaders) {
        if (input.removeProviderCredentials) removeProviderCredentialHeaders(headers, input.provider);
        for (const [name, value] of Object.entries(input.gatewayHeaders)) headers.set(name, value);
      } else {
        removeGatewayHeaders(headers);
      }
      const signal = input.source.signal
        ? AbortSignal.any([input.source.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)])
        : AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      const response = await this.fetchImpl()(input.url, {
        method: input.source.method,
        headers,
        body: replayableBody(input.body, input.source.method),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      statusCode = response.status;
      return response;
    } finally {
      this.log({
        event: "llm_gateway_request",
        provider: input.provider,
        organizationId: hashedOrganizationId(input.organizationId),
        duration: Math.max(0, Math.round(this.now() - started)),
        statusCode,
        requestId: input.requestId,
        route: input.route,
        fallbackPolicy: explicitFallbackEnabled() ? "explicit_transient_only" : "disabled",
      });
    }
  }

  private fetchImpl() {
    return this.dependencies.fetch ?? globalThis.fetch;
  }

  private now() {
    return (this.dependencies.now ?? (() => performance.now()))();
  }

  private log(entry: SafeLogEntry) {
    if (this.dependencies.log) return this.dependencies.log(entry);
    console.info(JSON.stringify(entry));
  }
}

export const llmGateway = new LLMGateway();

export function cloudflareAiGatewayStatus() {
  return llmGateway.status();
}
