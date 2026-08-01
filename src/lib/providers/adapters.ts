import { joinUrl, providerJson, providerStream, sseJson } from "@/lib/providers/http";
import {
  type DiscoveryResult,
  type ProviderAdapter,
  type ProviderMessage,
  type ProviderUsage,
  ProviderError,
} from "@/lib/providers/types";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";
import { llmGateway } from "@/lib/providers/llm-gateway";

const capabilities = {
  streaming: true,
  systemMessages: true,
  configurableTemperature: true,
  maxOutputTokens: true,
} as const;

function textContent(message: ProviderMessage) {
  return typeof message.content === "string"
    ? message.content
    : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function openAiResponsesMessages(messages: ProviderMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : message.content.map((part) =>
      part.type === "text" ? { type: "input_text", text: part.text }
        : { type: "input_image", image_url: `data:${part.mediaType};base64,${part.data}` }),
  }));
}

function openAiChatMessages(messages: ProviderMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : message.content.map((part) =>
      part.type === "text" ? { type: "text", text: part.text }
        : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.data}` } }),
  }));
}

function anthropicMessages(messages: ProviderMessage[]) {
  return messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : message.content.map((part) =>
      part.type === "text" ? { type: "text", text: part.text }
        : { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.data } }),
  }));
}

function geminiParts(message: ProviderMessage) {
  return typeof message.content === "string" ? [{ text: message.content }] : message.content.map((part) =>
    part.type === "text" ? { text: part.text } : { inlineData: { mimeType: part.mediaType, data: part.data } });
}

function values(input: unknown, key: string): unknown[] {
  return input && typeof input === "object" && key in input && Array.isArray((input as Record<string, unknown>)[key])
    ? (input as Record<string, unknown>)[key] as unknown[]
    : [];
}

function modelIds(input: unknown, container = "data", key = "id") {
  return [...new Set(values(input, container).map((item) => (
    item && typeof item === "object" && key in item ? String((item as Record<string, unknown>)[key]) : ""
  )).filter(Boolean))].sort().slice(0, 500);
}

function normalizeError(error: unknown) {
  if (error instanceof ProviderError) return error;
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ProviderError("PROVIDER_TIMEOUT", "انتهت مهلة الاتصال بالمزود.", 504, 408, true);
  }
  return new ProviderError("PROVIDER_ERROR", "تعذر إكمال طلب المزود.", 502);
}

function abort() {
  return new AbortController();
}

function openAiTransport(input: {
  baseUrl: string;
  organizationId?: string;
  requestId: string;
}) {
  return llmGateway.resolve({
    provider: "openai",
    directBaseUrl: input.baseUrl,
    organizationId: input.organizationId,
    requestId: input.requestId,
  });
}

async function discovery(
  url: string,
  headers: HeadersInit,
  input: { baseUrl: string; signal?: AbortSignal },
  extract: (data: unknown) => string[],
): Promise<DiscoveryResult> {
  const startedAt = performance.now();
  const safe = await validateProviderBaseUrl(input.baseUrl);
  const { data } = await providerJson<unknown>(url, { headers }, { signal: input.signal, retries: 1 });
  const models = extract(data);
  if (models.length === 0) {
    throw new ProviderError("MODELS_ENDPOINT_UNSUPPORTED", "تم الاتصال بالمزود لكن مسار النماذج لم يُرجع نماذج قابلة للاستخدام.", 422);
  }
  return {
    normalizedBaseUrl: safe.normalizedUrl,
    models,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

const openai: ProviderAdapter = {
  kind: "openai",
  defaultBaseUrl: "https://api.openai.com/v1",
  capabilities,
  abort,
  normalizeError,
  normalizeUsage(input): ProviderUsage {
    const usage = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    };
  },
  async discoverModels(input) {
    const startedAt = performance.now();
    const safe = await validateProviderBaseUrl(input.baseUrl);
    const transport = openAiTransport(input);
    const { data } = await providerJson<unknown>(joinUrl(transport.baseUrl, "models"), {
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: "application/json",
        "x-client-request-id": input.requestId,
        ...transport.headers,
      },
    }, {
      signal: input.signal,
      retries: transport.gateway ? 0 : 1,
      fetch: transport.fetch,
    });
    const models = modelIds(data);
    if (models.length === 0) {
      throw new ProviderError(
        "MODELS_ENDPOINT_UNSUPPORTED",
        "تم الاتصال بالمزود لكن مسار النماذج لم يُرجع نماذج قابلة للاستخدام.",
        422,
      );
    }
    return {
      normalizedBaseUrl: safe.normalizedUrl,
      models,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  },
  async generate(input) {
    const transport = openAiTransport(input);
    const { data, headers } = await providerJson<{
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: unknown;
    }>(joinUrl(transport.baseUrl, "responses"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
        "x-client-request-id": input.requestId,
        ...transport.headers,
      },
      body: JSON.stringify({
        model: input.model,
        input: openAiResponsesMessages(input.messages),
        temperature: input.temperature,
        max_output_tokens: input.maxOutputTokens,
      }),
    }, {
      signal: input.signal,
      timeoutMs: 60_000,
      retries: transport.gateway ? 0 : 1,
      fetch: transport.fetch,
    });
    const text = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
    return { text, ...openai.normalizeUsage(data.usage), providerRequestId: headers.get("x-request-id") ?? undefined };
  },
  testModel(input) {
    return openai.generate({ ...input, messages: [{ role: "user", content: "Reply with OK." }], maxOutputTokens: 16, temperature: 0 });
  },
  async *stream(input) {
    const transport = openAiTransport(input);
    const response = await providerStream(joinUrl(transport.baseUrl, "responses"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
        "x-client-request-id": input.requestId,
        ...transport.headers,
      },
      body: JSON.stringify({
        model: input.model,
        input: openAiResponsesMessages(input.messages),
        temperature: input.temperature,
        max_output_tokens: input.maxOutputTokens,
        stream: true,
      }),
    }, { signal: input.signal, timeoutMs: 60_000, fetch: transport.fetch });
    const providerRequestId = response.headers.get("x-request-id") ?? undefined;
    for await (const event of sseJson(response)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        yield { type: "delta", text: event.delta };
      } else if (event.type === "response.completed" && event.response && typeof event.response === "object") {
        yield { type: "usage", usage: openai.normalizeUsage((event.response as Record<string, unknown>).usage), providerRequestId };
      }
    }
    yield { type: "done", providerRequestId };
  },
};

const openaiCompatible: ProviderAdapter = {
  ...openai,
  kind: "openai_compatible",
  defaultBaseUrl: "",
  discoverModels(input) {
    return discovery(
      joinUrl(input.baseUrl, "models"),
      { authorization: `Bearer ${input.apiKey}`, accept: "application/json", "x-client-request-id": input.requestId },
      input,
      (data) => modelIds(data),
    );
  },
  async generate(input) {
    const { data, headers } = await providerJson<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(joinUrl(input.baseUrl, "chat/completions"), {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", "x-client-request-id": input.requestId },
      body: JSON.stringify({
        model: input.model,
        messages: openAiChatMessages(input.messages),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
      }),
    }, { signal: input.signal, timeoutMs: 90_000 });
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
    return {
      text,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      providerRequestId: headers.get("x-request-id") ?? undefined,
    };
  },
  testModel(input) {
    return openaiCompatible.generate({ ...input, messages: [{ role: "user", content: "Reply with OK." }], maxOutputTokens: 16, temperature: 0 });
  },
  async *stream(input) {
    const response = await providerStream(joinUrl(input.baseUrl, "chat/completions"), {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", "x-client-request-id": input.requestId },
      body: JSON.stringify({
        model: input.model,
        messages: openAiChatMessages(input.messages),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    }, { signal: input.signal, timeoutMs: 90_000 });
    const providerRequestId = response.headers.get("x-request-id") ?? undefined;
    for await (const event of sseJson(response)) {
      const choices = Array.isArray(event.choices) ? event.choices : [];
      const first = choices[0] as { delta?: { content?: string } } | undefined;
      if (first?.delta?.content) yield { type: "delta", text: first.delta.content };
      if (event.usage && typeof event.usage === "object") {
        const usage = event.usage as Record<string, unknown>;
        yield {
          type: "usage",
          usage: {
            inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
            outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
          },
          providerRequestId,
        };
      }
    }
    yield { type: "done", providerRequestId };
  },
};

const anthropic: ProviderAdapter = {
  kind: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  capabilities,
  abort,
  normalizeError,
  normalizeUsage(input): ProviderUsage {
    const usage = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    };
  },
  discoverModels(input) {
    return discovery(
      joinUrl(input.baseUrl, "v1/models"),
      { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", accept: "application/json" },
      input,
      (data) => modelIds(data),
    );
  },
  async generate(input) {
    const system = input.messages.filter((message) => message.role === "system").map(textContent).join("\n\n");
    const { data, headers } = await providerJson<{
      content?: Array<{ type?: string; text?: string }>;
      usage?: unknown;
    }>(joinUrl(input.baseUrl, "v1/messages"), {
      method: "POST",
      headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        system: system || undefined,
        messages: anthropicMessages(input.messages),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
      }),
    }, { signal: input.signal, timeoutMs: 90_000 });
    const text = data.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
    return { text, ...anthropic.normalizeUsage(data.usage), providerRequestId: headers.get("request-id") ?? undefined };
  },
  testModel(input) {
    return anthropic.generate({ ...input, messages: [{ role: "user", content: "Reply with OK." }], maxOutputTokens: 16, temperature: 0 });
  },
  async *stream(input) {
    const system = input.messages.filter((message) => message.role === "system").map(textContent).join("\n\n");
    const response = await providerStream(joinUrl(input.baseUrl, "v1/messages"), {
      method: "POST",
      headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        system: system || undefined,
        messages: anthropicMessages(input.messages),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
        stream: true,
      }),
    }, { signal: input.signal, timeoutMs: 90_000 });
    const providerRequestId = response.headers.get("request-id") ?? undefined;
    for await (const event of sseJson(response)) {
      if (event.type === "content_block_delta" && event.delta && typeof event.delta === "object") {
        const text = (event.delta as Record<string, unknown>).text;
        if (typeof text === "string") yield { type: "delta", text };
      }
      if (event.type === "message_delta" && event.usage) {
        yield { type: "usage", usage: anthropic.normalizeUsage(event.usage), providerRequestId };
      }
    }
    yield { type: "done", providerRequestId };
  },
};

const gemini: ProviderAdapter = {
  kind: "gemini",
  defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  capabilities,
  abort,
  normalizeError,
  normalizeUsage(input): ProviderUsage {
    const usage = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return {
      inputTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null,
      outputTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
    };
  },
  discoverModels(input) {
    return discovery(
      joinUrl(input.baseUrl, "models"),
      { "x-goog-api-key": input.apiKey, accept: "application/json" },
      input,
      (data) => modelIds(data, "models", "name").map((model) => model.replace(/^models\//, "")),
    );
  },
  async generate(input) {
    const system = input.messages.filter((message) => message.role === "system").map(textContent).join("\n\n");
    const { data, headers } = await providerJson<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: unknown;
    }>(joinUrl(input.baseUrl, `models/${encodeURIComponent(input.model)}:generateContent`), {
      method: "POST",
      headers: { "x-goog-api-key": input.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: input.messages.filter((message) => message.role !== "system").map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: geminiParts(message),
        })),
        generationConfig: { temperature: input.temperature, maxOutputTokens: input.maxOutputTokens },
      }),
    }, { signal: input.signal, timeoutMs: 90_000 });
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) throw new ProviderError("PROVIDER_EMPTY_OUTPUT", "لم يُرجع النموذج نصًا.", 502);
    return { text, ...gemini.normalizeUsage(data.usageMetadata), providerRequestId: headers.get("x-request-id") ?? undefined };
  },
  testModel(input) {
    return gemini.generate({ ...input, messages: [{ role: "user", content: "Reply with OK." }], maxOutputTokens: 16, temperature: 0 });
  },
  async *stream(input) {
    const system = input.messages.filter((message) => message.role === "system").map(textContent).join("\n\n");
    const url = `${joinUrl(input.baseUrl, `models/${encodeURIComponent(input.model)}:streamGenerateContent`)}?alt=sse`;
    const response = await providerStream(url, {
      method: "POST",
      headers: { "x-goog-api-key": input.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: input.messages.filter((message) => message.role !== "system").map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: geminiParts(message),
        })),
        generationConfig: { temperature: input.temperature, maxOutputTokens: input.maxOutputTokens },
      }),
    }, { signal: input.signal, timeoutMs: 90_000 });
    const providerRequestId = response.headers.get("x-request-id") ?? undefined;
    for await (const event of sseJson(response)) {
      const candidates = Array.isArray(event.candidates) ? event.candidates : [];
      const parts = (candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined)?.content?.parts ?? [];
      const text = parts.map((part) => part.text ?? "").join("");
      if (text) yield { type: "delta", text };
      if (event.usageMetadata) yield { type: "usage", usage: gemini.normalizeUsage(event.usageMetadata), providerRequestId };
    }
    yield { type: "done", providerRequestId };
  },
};

export const providerAdapters = { openai, anthropic, gemini, openai_compatible: openaiCompatible } as const;
