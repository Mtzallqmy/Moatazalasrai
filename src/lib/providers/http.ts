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

  if (/resource\s*exhausted|resourceexhausted/i.test(searchable)
      && /worker\s+local\s+total\s+request\s+limit\s+reached/i.test(searchable)) {
    return new ProviderError(
      "PROVIDER_CAPACITY_EXHAUSTED",
      "سعة التنفيذ لدى المزود ممتلئة مؤقتًا. لم يبدأ توليد الرد.",
      503,
      status,
      true,
      retryMs ?? 60_000,
    );
  }

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

const REQUEST_TIMEOUT = Symbol("provider-request-timeout");

function linkedSignal(source: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromSource = () => controller.abort(source?.reason);
  source?.addEventListener("abort", abortFromSource, { once: true });
  const timeout = setTimeout(() => controller.abort(REQUEST_TIMEOUT), timeoutMs);
  return {
    signal: controller.signal,
    clearRequestTimeout: () => clearTimeout(timeout),
    cleanup: () => {
      clearTimeout(timeout);
      source?.removeEventListener("abort", abortFromSource);
    },
  };
}

function retryDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499));
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

type RequestResult = {
  response: Response;
  clearRequestTimeout: () => void;
  cleanup: () => void;
};

async function request(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; signal?: AbortSignal; retries?: number; fetch?: typeof globalThis.fetch } = {},
) : Promise<RequestResult> {
  const attempts = Math.max(1, (options.retries ?? 1) + 1);
  let lastError: unknown;
  const safe = await validateProviderBaseUrl(url);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const linked = linkedSignal(options.signal, options.timeoutMs ?? 20_000);
    try {
      const response = await (options.fetch ?? globalThis.fetch)(safe.normalizedUrl, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: linked.signal,
      });
      if (!response.ok) {
        const bodyText = await readLimitedText(response, 32 * 1024).catch(() => "");
        const error = providerErrorForHttpStatus(response.status, bodyText, response.headers);
        if (error.retryable && attempt + 1 < attempts) {
          const delay = error.retryAfterMs ?? 200 * (2 ** attempt) + Math.floor(Math.random() * 120);
          linked.cleanup();
          await retryDelay(Math.min(delay, 30_000), options.signal);
          continue;
        }
        throw error;
      }
      return { response, clearRequestTimeout: linked.clearRequestTimeout, cleanup: linked.cleanup };
    } catch (error) {
      lastError = error;
      linked.cleanup();
      if (error instanceof ProviderError) throw error;
      if (options.signal?.aborted) throw new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
      if (linked.signal.reason === REQUEST_TIMEOUT || (error instanceof DOMException && error.name === "TimeoutError")) {
        const timeoutError = new ProviderError("PROVIDER_TIMEOUT", "انتهت مهلة الاتصال بالمزود.", 504, 408, true);
        if (attempt + 1 < attempts) {
          await retryDelay(200 * (2 ** attempt) + Math.floor(Math.random() * 120), options.signal);
          continue;
        }
        throw timeoutError;
      }
      if (attempt + 1 >= attempts) {
        throw new ProviderError("PROVIDER_NETWORK_ERROR", "تعذر إنشاء اتصال آمن بالمزود.", 502, undefined, true);
      }
      await retryDelay(200 * (2 ** attempt) + Math.floor(Math.random() * 120), options.signal);
    }
  }
  throw lastError;
}

export async function providerJson<T>(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number; signal?: AbortSignal; retries?: number; fetch?: typeof globalThis.fetch },
): Promise<{ data: T; headers: Headers }> {
  try {
    const result = await request(url, init, options);
    try {
      const text = await readLimitedText(result.response);
      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        throw new ProviderError("PROVIDER_INVALID_RESPONSE", "أعاد المزود استجابة غير صالحة.", 502);
      }
      return { data, headers: result.response.headers };
    } catch (error) {
      if (options?.signal?.aborted) throw new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
      if (result.response.body && error instanceof DOMException && error.name === "AbortError") {
        throw new ProviderError("PROVIDER_TIMEOUT", "انتهت مهلة استجابة المزود.", 504, 408, true);
      }
      throw error;
    } finally {
      result.cleanup();
    }
  } catch (error) {
    throw error;
  }
}

const streamCleanup = new WeakMap<Response, () => void>();

export async function providerStream(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number; signal?: AbortSignal; fetch?: typeof globalThis.fetch },
) {
  const result = await request(url, init, { ...options, retries: 0 });
  if (!result.response.body) {
    result.cleanup();
    throw new ProviderError("PROVIDER_EMPTY_STREAM", "لم يُرجع المزود بثًا صالحًا.", 502);
  }
  // The request timeout protects connection establishment and first headers only.
  // Long generations remain cancellable by the caller and use an idle timeout below.
  result.clearRequestTimeout();
  streamCleanup.set(result.response, result.cleanup);
  return result.response;
}

function parseSseBlock(block: string) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
}

export async function* sseJson(
  response: Response,
  options: { idleTimeoutMs?: number } = {},
): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
  let buffer = "";
  let received = 0;
  try {
    while (true) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idleFailure = new Promise<never>((_, reject) => {
        idleTimer = setTimeout(() => reject(new ProviderError(
          "PROVIDER_TIMEOUT",
          "توقف المزود عن إرسال بيانات البث ضمن المهلة المسموحة.",
          504,
          408,
          true,
        )), idleTimeoutMs);
      });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), idleFailure]);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
      if (chunk.done) break;
      const value = chunk.value;
      received += value.byteLength;
      if (received > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new ProviderError("PROVIDER_RESPONSE_TOO_LARGE", "تجاوز البث الحد المسموح.", 502);
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = parseSseBlock(block);
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
    buffer += decoder.decode();
    if (buffer.trim()) {
      const data = parseSseBlock(buffer);
      if (data && data !== "[DONE]") {
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
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    streamCleanup.get(response)?.();
    streamCleanup.delete(response);
  }
}

export function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
