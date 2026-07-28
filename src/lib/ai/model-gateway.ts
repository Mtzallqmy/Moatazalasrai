export type ProviderKind = "openai" | "anthropic" | "gemini" | "openai_compatible";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateRequest = {
  provider: ProviderKind;
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export type GenerateResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  rawRequestId?: string;
};

async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ body: unknown; headers: Headers }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body && typeof body === "object" ? JSON.stringify(body) : response.statusText;
      throw new Error(`Provider request failed (${response.status}): ${detail.slice(0, 800)}`);
    }
    return { body, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedBaseUrl(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/$/, "");
}

async function generateOpenAI(request: GenerateRequest): Promise<GenerateResult> {
  const baseUrl = normalizedBaseUrl(request.baseUrl, "https://api.openai.com/v1");
  const { body, headers } = await requestJson(
    `${baseUrl}/responses`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        input: request.messages.map((message) => ({ role: message.role, content: message.content })),
        temperature: request.temperature,
        max_output_tokens: request.maxOutputTokens,
      }),
    },
    request.timeoutMs ?? 90_000
  );
  const data = body as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no text output.");
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    rawRequestId: headers.get("x-request-id") ?? undefined,
  };
}

async function generateOpenAICompatible(request: GenerateRequest): Promise<GenerateResult> {
  if (!request.baseUrl) throw new Error("Base URL is required for OpenAI-compatible providers.");
  const baseUrl = normalizedBaseUrl(request.baseUrl, request.baseUrl);
  const { body, headers } = await requestJson(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
      }),
    },
    request.timeoutMs ?? 90_000
  );
  const data = body as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI-compatible provider returned no text output.");
  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    rawRequestId: headers.get("x-request-id") ?? undefined,
  };
}

async function generateAnthropic(request: GenerateRequest): Promise<GenerateResult> {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const messages = request.messages.filter((message) => message.role !== "system");
  const baseUrl = normalizedBaseUrl(request.baseUrl, "https://api.anthropic.com");
  const { body, headers } = await requestJson(
    `${baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        system: system || undefined,
        messages,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens ?? 2048,
      }),
    },
    request.timeoutMs ?? 90_000
  );
  const data = body as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned no text output.");
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    rawRequestId: headers.get("request-id") ?? undefined,
  };
}

async function generateGemini(request: GenerateRequest): Promise<GenerateResult> {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const contents = request.messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
  const baseUrl = normalizedBaseUrl(request.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  const { body } = await requestJson(
    `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
        },
      }),
    },
    request.timeoutMs ?? 90_000
  );
  const data = body as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no text output.");
  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

export async function generateText(request: GenerateRequest): Promise<GenerateResult> {
  if (!request.apiKey || !request.model || request.messages.length === 0) {
    throw new Error("Provider key, model, and messages are required.");
  }
  switch (request.provider) {
    case "openai": return generateOpenAI(request);
    case "openai_compatible": return generateOpenAICompatible(request);
    case "anthropic": return generateAnthropic(request);
    case "gemini": return generateGemini(request);
  }
}
