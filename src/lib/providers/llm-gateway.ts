import { createHash } from "node:crypto";
import type { ProviderKind } from "@/lib/providers/types";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

const DEFAULT_TIMEOUT_MS = 60_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const CLOUDFLARE_GATEWAY_HOST = "gateway.ai.cloudflare.com";

type SafeLogEntry = {
  event: "llm_gateway_request";
  provider: ProviderKind;
  organizationId?: string;
  duration: number;
  statusCode: number | null;
  requestId?: string;
  route: "gateway" | "direct_fallback";
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
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 24)
    : undefined;
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function replaceBaseUrl(url: string, from: string, to: string) {
  const normalizedFrom = normalized(from);
  if (!url.startsWith(normalizedFrom)) {
    throw new Error("LLM_GATEWAY_REQUEST_URL_MISMATCH");
  }
  return `${normalized(to)}${url.slice(normalizedFrom.length)}`;
}

function replayableBody(bytes: ArrayBuffer, method: string) {
  return method === "GET" || method === "HEAD" || bytes.byteLength === 0
    ? undefined
    : bytes;
}

function gatewayHeaders(input: {
  organizationId?: string;
  requestId?: string;
}) {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const metadata = hashedOrganizationId(input.organizationId);
  return {
    "cf-aig-skip-cache": "true",
    "cf-aig-collect-log": "false",
    "cf-aig-max-attempts": "1",
    "cf-aig-request-timeout": String(DEFAULT_TIMEOUT_MS),
    ...(apiToken ? { "cf-aig-authorization": `Bearer ${apiToken}` } : {}),
    ...(input.requestId ? { "cf-aig-event-id": input.requestId } : {}),
    ...(metadata ? { "cf-aig-metadata": JSON.stringify({ organization: metadata }) } : {}),
  };
}

function removeGatewayHeaders(headers: Headers) {
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("cf-aig-")) headers.delete(name);
  }
}

export class LLMGateway {
  constructor(private readonly dependencies: GatewayDependencies = {}) {}

  status() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
    const configured = process.env.OPENAI_BASE_URL?.trim();
    return {
      enabled: enabled(process.env.CLOUDFLARE_AI_GATEWAY_ENABLED),
      gatewayUrl: configured
        ? normalized(configured)
        : accountId && gatewayId
          ? `https://${CLOUDFLARE_GATEWAY_HOST}/v1/${accountId}/${gatewayId}/compat`
          : undefined,
    };
  }

  resolve(input: {
    provider: ProviderKind;
    directBaseUrl: string;
    organizationId?: string;
    requestId?: string;
  }): LLMGatewayTransport {
    const directBaseUrl = normalized(input.directBaseUrl);
    if (!this.status().enabled || input.provider !== "openai") {
      return { baseUrl: directBaseUrl, headers: {}, gateway: false };
    }

    const configuration = this.configuration();
    const headers = gatewayHeaders(input);
    return {
      baseUrl: configuration.effectiveBaseUrl,
      configuredUrl: configuration.configuredUrl,
      headers,
      gateway: true,
      fetch: this.createGatewayFetch({
        ...input,
        directBaseUrl,
        gatewayBaseUrl: configuration.effectiveBaseUrl,
        headers,
      }),
    };
  }

  async reachability() {
    const status = this.status();
    if (!status.enabled) {
      return { enabled: false, reachable: false, gatewayUrl: status.gatewayUrl };
    }

    const configuration = this.configuration();
    const headers = new Headers();
    const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
    if (apiToken) headers.set("cf-aig-authorization", `Bearer ${apiToken}`);
    try {
      const response = await this.fetchImpl()(`${configuration.effectiveBaseUrl}/models`, {
        method: "HEAD",
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel().catch(() => undefined);
      return {
        enabled: true,
        reachable: true,
        gatewayUrl: configuration.configuredUrl,
        statusCode: response.status,
      };
    } catch {
      return {
        enabled: true,
        reachable: false,
        gatewayUrl: configuration.configuredUrl,
      };
    }
  }

  private configuration() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
    const configuredUrl = process.env.OPENAI_BASE_URL?.trim();
    if (!accountId || !gatewayId || !configuredUrl) {
      throw new Error(
        "Cloudflare AI Gateway requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_GATEWAY_ID and OPENAI_BASE_URL.",
      );
    }

    const cleanUrl = normalized(configuredUrl);
    const parsed = new URL(cleanUrl);
    if (
      parsed.protocol !== "https:"
      || parsed.hostname !== CLOUDFLARE_GATEWAY_HOST
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      throw new Error("OPENAI_BASE_URL must be a clean Cloudflare AI Gateway HTTPS URL.");
    }

    const expectedPrefix = `/v1/${accountId}/${gatewayId}/`;
    if (
      !parsed.pathname.startsWith(expectedPrefix)
      || (!parsed.pathname.endsWith("/compat") && !parsed.pathname.endsWith("/openai"))
    ) {
      throw new Error("OPENAI_BASE_URL does not match the configured Cloudflare account and gateway IDs.");
    }

    // /compat only supports the unified Chat Completions schema and provider-prefixed
    // model IDs. The provider-native sibling preserves existing model IDs plus the
    // OpenAI Responses API, streaming, tools and structured output.
    const effectiveBaseUrl = cleanUrl.endsWith("/compat")
      ? `${cleanUrl.slice(0, -"/compat".length)}/openai`
      : cleanUrl;

    return { configuredUrl: cleanUrl, effectiveBaseUrl };
  }

  private createGatewayFetch(input: {
    provider: ProviderKind;
    directBaseUrl: string;
    gatewayBaseUrl: string;
    headers: Record<string, string>;
    organizationId?: string;
    requestId?: string;
  }): typeof globalThis.fetch {
    return async (requestInput, requestInit) => {
      const source = new Request(requestInput, requestInit);
      const body = await source.clone().arrayBuffer();
      const gatewayUrl = requestUrl(source);
      const directUrl = replaceBaseUrl(gatewayUrl, input.gatewayBaseUrl, input.directBaseUrl);
      let usedFallback = false;
      const gatewayResponse = await this.attempt({
        url: gatewayUrl,
        source,
        body,
        provider: input.provider,
        organizationId: input.organizationId,
        requestId: input.requestId,
        route: "gateway",
        gatewayHeaders: input.headers,
      }).catch(async (error: unknown) => {
        if (source.signal.aborted) throw error;
        usedFallback = true;
        return this.attempt({
          url: directUrl,
          source,
          body,
          provider: input.provider,
          organizationId: input.organizationId,
          requestId: input.requestId,
          route: "direct_fallback",
        });
      });

      if (usedFallback || !RETRYABLE_STATUS_CODES.has(gatewayResponse.status)) return gatewayResponse;
      await gatewayResponse.body?.cancel().catch(() => undefined);
      if (source.signal.aborted) return gatewayResponse;
      return this.attempt({
        url: directUrl,
        source,
        body,
        provider: input.provider,
        organizationId: input.organizationId,
        requestId: input.requestId,
        route: "direct_fallback",
      });
    };
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
  }) {
    const started = this.now();
    let statusCode: number | null = null;
    try {
      await (this.dependencies.validateUrl ?? validateProviderBaseUrl)(input.url);
      const headers = new Headers(input.source.headers);
      if (input.gatewayHeaders) {
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
    if (this.dependencies.log) {
      this.dependencies.log(entry);
      return;
    }
    console.info(JSON.stringify(entry));
  }
}

export const llmGateway = new LLMGateway();

export function cloudflareAiGatewayStatus() {
  return llmGateway.status();
}
