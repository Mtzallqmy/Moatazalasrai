import { validateProviderBaseUrl } from "@/lib/security/provider-network";
import { ProviderError } from "@/lib/providers/types";

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function retryAfterMs(headers?: Headers) {
  const value = headers?.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5 * 60_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - Date.now()), 5 * 60_000);
}

function providerErrorDetails(text: string) {
  if (!text) return {} as { type?: string; message?: string };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const root = parsed as Record<string, unknown>;
    const candidate = root.error && typeof root.error === "object"
      ? root.error as Record<string, unknown>
      : root;
    return {
      type: typeof candidate.type === "string"
        ? candidate.type
        : typeof candidate.code === "string" ? candidate.code : undefined,
      message: typeof candidate.message === "string" ? candidate.message : undefined,
    };
  } catch {
    return {};
  }
}

export function providerErrorForHttpStatus(status: number, bodyText = "", headers?: Headers) {
  const details = providerErrorDetails(bodyText);
  const searchable = `${details.type ?? ""} ${details.message ?? ""}`.toLowerCase();
  const retryMs = retryAfterMs(headers);

  if (status === 400 && /context[_ -]?length|context window|maximum context|too many tokens/.test(searchable)) {
    return new ProviderError("CONTEXT_TOO_LARGE", "تجاوز سياق المحادثة الحد الذي يقبله النموذج.", 422, status);
  }
  if (status === 400) return new ProviderError("PROVIDER_REJECTED_INPUT", "رفض المزود إعدادات الطلب أو قيمه.", 422, status);
  if (status === 401) return new ProviderError("PROVIDER_UNAUTHORIZED", "رفض المزود مفتاح API. حدّث المفتاح ثم أعد الفحص.", 422, status);
  if (status === 402) return new ProviderError("PROVIDER_PAYMENT_REQUIRED", "رصيد المزود أو مفتاح API غير كافٍ. أضف رصيدًا أو استخدم مزودًا آخر.", 402, status);
  if (status === 403) return new ProviderError("PROVIDER_FORBIDDEN", "المفتاح صالح لكن لا يملك الصلاحية المطلوبة أو حظر المزود الطلب.", 422, status);
  if (status === 404) return new ProviderError("PROVIDER_ENDPOINT_NOT_FOUND", "لم يعثر المزود على المسار أو النموذج المطلوب.", 422, status);
  if (status === 408) return new ProviderError("PROVIDER_TIMEOUT", "انتهت مهلة الطلب لدى المزود.", 504, status, true, retryMs);
  if (status === 413) return new ProviderError("CONTEXT_TOO_LARGE", "حجم الطلب أو السياق أكبر من الحد الذي يقبله المزود.", 422, status);
  if (status === 422) return new ProviderError("PROVIDER_REJECTED_INPUT", "رفض المزود إعدادات الطلب أو اسم النموذج.", 422, status);
  if (status === 429) return new ProviderError("PROVIDER_RATE_LIMITED", "فرض المزود حدًا مؤقتًا على الطلبات.", 429, status, true, retryMs);
  if (status >= 500) return new ProviderError("PROVIDER_UNAVAILABLE", "خدمة المزود غير متاحة مؤقتًا.", 502, status, true, retryMs);
  return new ProviderError("PROVIDER_REQUEST_FAILED", `فشل طلب المزود برمز HTTP ${status}.`, 502, status);
}

export function providerErrorFromPayload(input: unknown) {
  if (!input || typeof input !== "object") {
    return new ProviderError("PROVIDER_STREAM_ERROR", "أعاد المزود خطأ أثناء البث.", 502);
  }
  const root = input as Record<string, unknown>;
  const candidate = root.error && typeof root.error === "object"
    ? root.error as Record<string, unknown>
    : root;
  const numericCode = typeof candidate.code === "number"
    ? candidate.code
    : typeof candidate.status === "number" ? candidate.status : undefined;
  if (numericCode) return providerErrorForHttpStatus(numericCode, JSON.stringify({ error: candidate }));

  const type = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "";
  if (type.includes("payment")) return providerErrorForHttpStatus(402, JSON.stringify({ error: candidate }));
  if (type.includes("authentication")) return providerErrorForHttpStatus(401, JSON.stringify({ error: candidate }));
  if (type.includes("permission") || type.includes("forbidden")) return providerErrorForHttpStatus(403, JSON.stringify({ error: candidate }));
  if (type.includes("rate_limit")) return providerErrorForHttpStatus(429, JSON.stringify({ error: candidate }));
  if (type.includes("overloaded") || type.includes("unavailable")) return providerErrorForHttpStatus(503, JSON.stringify({ error: candidate }));
  return new ProviderError("PROVIDER_STREAM_ERROR", "أعاد المزود خطأ أثناء توليد الرد.", 502);
}

async function readLimitedText(response: Response, maxBytes = MAX_JSON_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new ProviderError("PROVIDER_RESPONSE_TOO_LARGE", "تجاوز رد المزود الحجم المسموح.", 502);
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function linkedSignal(source: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return source ? AbortSignal.any([source, timeout]) : timeout;
}

async function request(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; signal?: AbortSignal; retries?: number } = {},
) {
  const attempts = Math.max(1, (options.retries ?? 1) + 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const signal = linkedSignal(options.signal, options.timeoutMs ?? 20_000);
    try {
      await validateProviderBaseUrl(url);
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        const bodyText = await readLimitedText(response, 32 * 1024).catch(() => "");
        const error = providerErrorForHttpStatus(response.status, bodyText, response.headers);
        if (error.retryable && attempt + 1 < attempts) {
          const delay = error.retryAfterMs ?? 200 * (2 ** attempt) + Math.floor(Math.random() * 120);
          await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)));
          continue;
        }
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError) throw error;
      if (options.signal?.aborted) throw new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
        const timeoutError = new ProviderError("PROVIDER_TIMEOUT", "انتهت مهلة الاتصال بالمزود.", 504, 408, true);
        if (attempt + 1 < attempts) continue;
        throw timeoutError;
      }
      if (attempt + 1 >= attempts) {
        throw new ProviderError("PROVIDER_NETWORK_ERROR", "تعذر إنشاء اتصال آمن بالمزود.", 502, undefined, true);
      }
    }
  }
  throw lastError;
}

export async function providerJson<T>(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number; signal?: AbortSignal; retries?: number },
): Promise<{ data: T; headers: Headers }> {
  const response = await request(url, init, options);
  const text = await readLimitedText(response);
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new ProviderError("PROVIDER_INVALID_RESPONSE", "أعاد المزود استجابة غير صالحة.", 502);
  }
  return { data, headers: response.headers };
}

export async function providerStream(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number; signal?: AbortSignal },
) {
  const response = await request(url, init, { ...options, retries: 0 });
  if (!response.body) throw new ProviderError("PROVIDER_EMPTY_STREAM", "لم يُرجع المزود بثًا صالحًا.", 502);
  return response;
}

export async function* sseJson(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > 8 * 1024 * 1024) {
      await reader.cancel();
      throw new ProviderError("PROVIDER_RESPONSE_TOO_LARGE", "تجاوز البث الحد المسموح.", 502);
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as unknown;
        if (parsed && typeof parsed === "object") {
          const event = parsed as Record<string, unknown>;
          if (event.error || event.type === "error") throw providerErrorFromPayload(event);
          yield event;
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError("PROVIDER_INVALID_STREAM", "أعاد المزود حدث بث غير صالح.", 502);
      }
    }
  }
}

export function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
