export type ApiEnvelope<T> = {
  success: true;
  data: T;
  meta?: { requestId?: string; [key: string]: unknown };
} | {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable?: boolean;
    action?: { ar?: string; en?: string };
    details?: unknown;
  };
};

export class ApiClientError extends Error {
  readonly name = "ApiClientError";

  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly retryable = false,
    public readonly action?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const statusMessages: Record<number, string> = {
  401: "انتهت الجلسة أو لم تعد صالحة. سجّل الدخول مجددًا.",
  403: "لا تملك الصلاحية المطلوبة لتنفيذ هذا الإجراء.",
  404: "المورد المطلوب غير موجود أو لم يعد متاحًا.",
  409: "تعذر إكمال العملية بسبب تعارض في الحالة الحالية.",
  422: "تعذر تنفيذ الطلب بالبيانات الحالية. راجع الإعدادات وحاول مجددًا.",
  429: "تم تجاوز الحد المؤقت للطلبات. انتظر قليلًا ثم أعد المحاولة.",
  500: "حدث خطأ داخلي غير متوقع.",
  502: "تعذر الوصول إلى الخدمة الخارجية.",
  503: "الخدمة غير متاحة مؤقتًا.",
  504: "انتهت مهلة الاتصال بالخدمة.",
};

function requestId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  timeoutMs?: number;
  redirectOnUnauthorized?: boolean;
};

export async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const { timeoutMs = 20_000, redirectOnUnauthorized = true, body: inputBody, signal: externalSignal, ...requestInit } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  const headers = new Headers(requestInit.headers);
  headers.set("accept", "application/json");
  headers.set("x-request-id", headers.get("x-request-id") ?? requestId());
  let body = inputBody as BodyInit | null | undefined;
  if (body !== undefined && body !== null && !(body instanceof FormData) && !(body instanceof URLSearchParams)
    && !(body instanceof Blob) && typeof body !== "string" && !(body instanceof ArrayBuffer)) {
    headers.set("content-type", headers.get("content-type") ?? "application/json");
    body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, {
      ...requestInit,
      body,
      headers,
      credentials: requestInit.credentials ?? "same-origin",
      cache: requestInit.cache ?? "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
    if (!response.ok || !payload || payload.success !== true) {
      const failure = payload && payload.success === false ? payload.error : undefined;
      const message = failure?.message || statusMessages[response.status] || "تعذر إكمال الطلب.";
      const error = new ApiClientError(
        response.status,
        failure?.code || `HTTP_${response.status}`,
        message,
        failure?.requestId || response.headers.get("x-request-id") || undefined,
        failure?.retryable === true,
        failure?.action?.ar,
        failure?.details,
      );
      if (response.status === 401 && redirectOnUnauthorized && typeof window !== "undefined") {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      }
      throw error;
    }
    return payload.data;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (controller.signal.aborted) {
      throw new ApiClientError(0, "REQUEST_ABORTED", controller.signal.reason === "timeout" ? "انتهت مهلة الطلب." : "أُلغي الطلب.");
    }
    throw new ApiClientError(0, "NETWORK_ERROR", "تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export function apiErrorMessage(error: unknown, fallback = "تعذر إكمال العملية.") {
  if (error instanceof ApiClientError) {
    const suffix = error.requestId ? ` (معرّف الطلب: ${error.requestId})` : "";
    return `${error.message}${suffix}`;
  }
  return error instanceof Error ? error.message : fallback;
}
