type ProviderKind = "openai" | "anthropic" | "gemini" | "openai_compatible";

type DiscoveryInput = {
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
};

export type ProviderDiscoveryResult = {
  normalizedBaseUrl: string;
  models: string[];
  latencyMs: number;
};

const MAX_MODELS = 250;
const TIMEOUT_MS = 12_000;

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("يجب أن يستخدم Base URL بروتوكول HTTPS في الإنتاج.");
  }
  if (!new Set(["https:", "http:"]).has(parsed.protocol)) {
    throw new Error("بروتوكول Base URL غير مدعوم.");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function uniqueModels(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_MODELS);
}

async function fetchJson(url: string, init: RequestInit): Promise<{ body: unknown; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const safeMessage = typeof body === "object" && body && "error" in body
        ? JSON.stringify((body as { error?: unknown }).error).slice(0, 300)
        : `HTTP ${response.status}`;
      throw new Error(`رفض المزود بيانات الاتصال: ${safeMessage}`);
    }
    return { body, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("انتهت مهلة الاتصال بالمزود.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverProviderModels(input: DiscoveryInput): Promise<ProviderDiscoveryResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  if (input.provider === "anthropic") {
    const { body, latencyMs } = await fetchJson(`${baseUrl}/v1/models`, {
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        accept: "application/json",
      },
    });
    const data = typeof body === "object" && body && "data" in body ? (body as { data?: unknown }).data : [];
    const models = uniqueModels(Array.isArray(data) ? data.map((item) => typeof item === "object" && item && "id" in item ? (item as { id?: unknown }).id : null) : []);
    if (models.length === 0) throw new Error("تم الاتصال بـAnthropic لكن لم تُرجع الخدمة نماذج متاحة.");
    return { normalizedBaseUrl: baseUrl, models, latencyMs };
  }

  if (input.provider === "gemini") {
    const separator = baseUrl.includes("?") ? "&" : "?";
    const { body, latencyMs } = await fetchJson(`${baseUrl}/models${separator}key=${encodeURIComponent(input.apiKey)}`, {
      headers: { accept: "application/json" },
    });
    const data = typeof body === "object" && body && "models" in body ? (body as { models?: unknown }).models : [];
    const models = uniqueModels(Array.isArray(data) ? data.map((item) => typeof item === "object" && item && "name" in item ? String((item as { name?: unknown }).name).replace(/^models\//, "") : null) : []);
    if (models.length === 0) throw new Error("تم الاتصال بـGemini لكن لم تُرجع الخدمة نماذج متاحة.");
    return { normalizedBaseUrl: baseUrl, models, latencyMs };
  }

  const { body, latencyMs } = await fetchJson(`${baseUrl}/models`, {
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      accept: "application/json",
    },
  });
  const data = typeof body === "object" && body && "data" in body ? (body as { data?: unknown }).data : [];
  const models = uniqueModels(Array.isArray(data) ? data.map((item) => typeof item === "object" && item && "id" in item ? (item as { id?: unknown }).id : null) : []);
  if (models.length === 0) throw new Error("تم الاتصال بالمزود لكن لم تُرجع الخدمة نماذج متاحة.");
  return { normalizedBaseUrl: baseUrl, models, latencyMs };
}

export function defaultBaseUrl(provider: ProviderKind): string {
  switch (provider) {
    case "openai": return "https://api.openai.com/v1";
    case "anthropic": return "https://api.anthropic.com";
    case "gemini": return "https://generativelanguage.googleapis.com/v1beta";
    default: return "";
  }
}
