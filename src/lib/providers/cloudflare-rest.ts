import { aiGatewayRestBaseUrl, restApiHeaders } from "@/lib/providers/cloudflare-endpoints";
import { normalizeUnknownProviderError } from "@/lib/providers/errors";
import { joinUrl, providerJson, providerStream, sseJson } from "@/lib/providers/http";
import { ProviderError, type ProviderKind, type ProviderMessage, type ProviderStreamChunk, type ProviderUsage } from "@/lib/providers/types";


export function validateCloudflareRestModel(provider: ProviderKind | undefined, model: string) {
  const normalized = model.trim();
  if (!normalized || !normalized.includes("/")) {
    throw new ProviderError("MODEL_UNAVAILABLE", "اسم نموذج AI Gateway REST يجب أن يتبع صيغة provider/model.", 422, 404, false, undefined, {
      category: "model_unavailable",
      provider: "cloudflare-ai-gateway",
      model: normalized,
    });
  }
  const allowedPrefixes = provider === "openai"
    ? ["openai/"]
    : provider === "anthropic"
      ? ["anthropic/"]
      : provider === "gemini"
        ? ["google/", "google-ai-studio/"]
        : [];
  if (allowedPrefixes.length > 0 && !allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    throw new ProviderError("MODEL_PROVIDER_MISMATCH", "اسم النموذج لا يطابق المزود المحدد لاتصال AI Gateway REST.", 422, 400, false, undefined, {
      category: "misconfigured",
      provider: "cloudflare-ai-gateway",
      model: normalized,
      technicalMessage: `Expected one of: ${allowedPrefixes.join(", ")}`,
    });
  }
  return normalized;
}

function chatMessages(messages: ProviderMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((part) => part.type === "text"
        ? { type: "text", text: part.text }
        : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.data}` } }),
  }));
}

function usage(value: unknown): ProviderUsage {
  if (!value || typeof value !== "object") return { inputTokens: null, outputTokens: null };
  const record = value as Record<string, unknown>;
  return {
    inputTokens: typeof record.prompt_tokens === "number" ? record.prompt_tokens : null,
    outputTokens: typeof record.completion_tokens === "number" ? record.completion_tokens : null,
  };
}

function cloudflareToken() {
  return process.env.CLOUDFLARE_API_TOKEN?.trim() || "";
}

export async function runCloudflareRestChat(input: {
  accountId?: string;
  gatewayId?: string;
  model: string;
  providerKind?: ProviderKind;
  messages: ProviderMessage[];
  temperature: number;
  maxOutputTokens: number;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
  requestId?: string;
  signal?: AbortSignal;
}) {
  const accountId = input.accountId?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayId = input.gatewayId?.trim() || process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
  const model = validateCloudflareRestModel(input.providerKind, input.model);
  if (!accountId || !gatewayId) throw new ProviderError("PROVIDER_CONFIG_INVALID", "إعدادات Cloudflare AI Gateway REST غير مكتملة.", 422);
  try {
    const { data, headers } = await providerJson<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    }>(joinUrl(aiGatewayRestBaseUrl(accountId), "chat/completions"), {
      method: "POST",
      headers: {
        ...restApiHeaders({
          apiToken: cloudflareToken(),
          gatewayId,
          skipCache: input.skipCache,
          cacheTtl: input.cacheTtl,
          collectLog: input.collectLog,
        }),
        ...(input.requestId ? { "x-client-request-id": input.requestId } : {}),
      },
      body: JSON.stringify({
        model,
        messages: chatMessages(input.messages),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
      }),
    }, { timeoutMs: 90_000, retries: 1, signal: input.signal });
    const text = data.choices?.[0]?.message?.content;
    if (!text?.trim()) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم تُرجع Cloudflare AI Gateway REST نصًا.", 502);
    return { text, ...usage(data.usage), providerRequestId: headers.get("cf-ray") ?? headers.get("x-request-id") ?? undefined };
  } catch (error) {
    throw normalizeUnknownProviderError(error, { provider: "cloudflare-ai-gateway", model, requestId: input.requestId });
  }
}

export async function* streamCloudflareRestChat(input: Parameters<typeof runCloudflareRestChat>[0]): AsyncGenerator<ProviderStreamChunk> {
  const accountId = input.accountId?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayId = input.gatewayId?.trim() || process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
  const model = validateCloudflareRestModel(input.providerKind, input.model);
  if (!accountId || !gatewayId) throw new ProviderError("PROVIDER_CONFIG_INVALID", "إعدادات Cloudflare AI Gateway REST غير مكتملة.", 422);
  try {
    const response = await providerStream(joinUrl(aiGatewayRestBaseUrl(accountId), "chat/completions"), {
      method: "POST",
      headers: {
        ...restApiHeaders({ apiToken: cloudflareToken(), gatewayId, skipCache: input.skipCache, cacheTtl: input.cacheTtl, collectLog: input.collectLog }),
        ...(input.requestId ? { "x-client-request-id": input.requestId } : {}),
      },
      body: JSON.stringify({
        model,
        messages: chatMessages(input.messages),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    }, { timeoutMs: 90_000, signal: input.signal });
    const providerRequestId = response.headers.get("cf-ray") ?? response.headers.get("x-request-id") ?? undefined;
    let emitted = false;
    for await (const event of sseJson(response)) {
      const choices = Array.isArray(event.choices) ? event.choices : [];
      const text = (choices[0] as { delta?: { content?: string } } | undefined)?.delta?.content;
      if (text) {
        emitted = true;
        yield { type: "delta", text };
      }
      if (event.usage) yield { type: "usage", usage: usage(event.usage), providerRequestId };
    }
    if (!emitted) throw new ProviderError("PROVIDER_EMPTY_STREAM", "انتهى بث Cloudflare دون نص.", 502);
    yield { type: "done", providerRequestId };
  } catch (error) {
    throw normalizeUnknownProviderError(error, { provider: "cloudflare-ai-gateway", model, requestId: input.requestId });
  }
}
