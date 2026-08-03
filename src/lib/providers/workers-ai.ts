import { normalizeUnknownProviderError } from "@/lib/providers/errors";
import { ProviderError, type ProviderCapabilities, type ProviderMessage, type ProviderStreamChunk, type ProviderUsage } from "@/lib/providers/types";

type WorkersAiRunOptions = {
  gateway?: {
    id: string;
    skipCache?: boolean;
    cacheTtl?: number;
    collectLog?: boolean;
  };
};

type WorkersAiBinding = {
  run(model: string, input: Record<string, unknown>, options?: WorkersAiRunOptions): Promise<unknown>;
};

type WorkersAiResponse = {
  response?: unknown;
  result?: unknown;
  usage?: unknown;
};

export const workersAiCapabilities: ProviderCapabilities = {
  streaming: true,
  systemMessages: true,
  configurableTemperature: true,
  maxOutputTokens: true,
  modelDiscovery: false,
  serverExecution: true,
  backgroundExecution: true,
  tools: false,
};

function textContent(message: ProviderMessage) {
  return typeof message.content === "string"
    ? message.content
    : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function workersMessages(messages: ProviderMessage[]) {
  return messages.map((message) => ({ role: message.role, content: textContent(message) }));
}

function normalizeUsage(value: unknown): ProviderUsage {
  if (!value || typeof value !== "object") return { inputTokens: null, outputTokens: null };
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number" ? usage.output_tokens : null,
  };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const result = value as WorkersAiResponse;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result === "string") return result.result;
  return "";
}

function gatewayOptions(input: {
  gatewayId?: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
}): WorkersAiRunOptions | undefined {
  if (!input.gatewayId) return undefined;
  return {
    gateway: {
      id: input.gatewayId,
      skipCache: input.skipCache ?? true,
      cacheTtl: input.cacheTtl,
      collectLog: input.collectLog ?? false,
    },
  };
}

export async function getWorkersAiBinding(): Promise<WorkersAiBinding> {
  try {
    const cloudflare = await import("@opennextjs/cloudflare");
    const context = await cloudflare.getCloudflareContext({ async: true });
    const env = context.env as Record<string, unknown>;
    const binding = env.AI;
    if (!binding || typeof binding !== "object" || !("run" in binding) || typeof (binding as { run?: unknown }).run !== "function") {
      throw new Error("AI binding is absent");
    }
    return binding as WorkersAiBinding;
  } catch (error) {
    throw new ProviderError(
      "WORKERS_AI_BINDING_UNAVAILABLE",
      "ربط Workers AI غير متاح في بيئة التشغيل الحالية.",
      503,
      undefined,
      false,
      undefined,
      {
        category: "misconfigured",
        provider: "cloudflare-workers-ai",
        technicalMessage: error instanceof Error ? error.message.slice(0, 300) : "AI binding unavailable",
      },
    );
  }
}

export function validateWorkersAiModel(model: string) {
  const normalized = model.trim();
  if (!/^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(normalized)) {
    throw new ProviderError(
      "MODEL_UNAVAILABLE",
      "اسم نموذج Workers AI يجب أن يكون معرفًا رسميًا يبدأ بـ@cf/.",
      422,
      404,
      false,
      undefined,
      { category: "model_unavailable", provider: "cloudflare-workers-ai", model: normalized },
    );
  }
  return normalized;
}

export async function runWorkersAiChat(input: {
  model: string;
  messages: ProviderMessage[];
  temperature: number;
  maxOutputTokens: number;
  gatewayId?: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
  binding?: WorkersAiBinding;
  requestId?: string;
}) {
  const model = validateWorkersAiModel(input.model);
  const binding = input.binding ?? await getWorkersAiBinding();
  try {
    const result = await binding.run(model, {
      messages: workersMessages(input.messages),
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
    }, gatewayOptions(input));
    const text = extractText(result);
    if (!text.trim()) {
      throw new ProviderError(
        "PROVIDER_EMPTY_OUTPUT",
        "لم يُرجع Workers AI نصًا قابلًا للاستخدام.",
        502,
        undefined,
        false,
        undefined,
        { category: "empty_response", provider: "cloudflare-workers-ai", model, requestId: input.requestId },
      );
    }
    const usage = result && typeof result === "object" ? normalizeUsage((result as WorkersAiResponse).usage) : normalizeUsage(undefined);
    return { text, ...usage };
  } catch (error) {
    throw normalizeUnknownProviderError(error, {
      provider: "cloudflare-workers-ai",
      model,
      requestId: input.requestId,
    });
  }
}

export async function* streamWorkersAiChat(input: {
  model: string;
  messages: ProviderMessage[];
  temperature: number;
  maxOutputTokens: number;
  gatewayId?: string;
  skipCache?: boolean;
  cacheTtl?: number;
  collectLog?: boolean;
  binding?: WorkersAiBinding;
  requestId?: string;
  signal?: AbortSignal;
}): AsyncGenerator<ProviderStreamChunk> {
  const model = validateWorkersAiModel(input.model);
  const binding = input.binding ?? await getWorkersAiBinding();
  try {
    const result = await binding.run(model, {
      messages: workersMessages(input.messages),
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
      stream: true,
    }, gatewayOptions(input));
    if (!(result instanceof ReadableStream)) {
      const text = extractText(result);
      if (!text) throw new ProviderError("PROVIDER_EMPTY_STREAM", "لم يُرجع Workers AI بثًا صالحًا.", 502);
      yield { type: "delta", text };
      yield { type: "done" };
      return;
    }
    const reader = result.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = false;
    while (true) {
      if (input.signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new DOMException("Aborted", "AbortError");
      }
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const raw = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
        if (!raw || raw === "[DONE]") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          continue;
        }
        const text = extractText(parsed);
        if (text) {
          emitted = true;
          yield { type: "delta", text };
        }
      }
    }
    if (!emitted) {
      throw new ProviderError(
        "PROVIDER_EMPTY_STREAM",
        "انتهى بث Workers AI دون نص.",
        502,
        undefined,
        false,
        undefined,
        { category: "empty_response", provider: "cloudflare-workers-ai", model, requestId: input.requestId },
      );
    }
    yield { type: "done" };
  } catch (error) {
    throw normalizeUnknownProviderError(error, {
      provider: "cloudflare-workers-ai",
      model,
      requestId: input.requestId,
    });
  }
}
