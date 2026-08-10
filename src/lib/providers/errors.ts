import {
  ProviderError,
  type ProviderErrorCategory,
  type ProviderHealthStatus,
  type ProviderKind,
  type ProviderTypeId,
} from "@/lib/providers/types";

const CODE_CATEGORY: Record<string, ProviderErrorCategory> = {
  PROVIDER_UNAUTHORIZED: "authentication",
  PROVIDER_FORBIDDEN: "authorization",
  PROVIDER_PAYMENT_REQUIRED: "quota",
  PROVIDER_RATE_LIMITED: "rate_limit",
  PROVIDER_TIMEOUT: "timeout",
  PROVIDER_NETWORK_ERROR: "network",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  PROVIDER_CAPACITY_EXHAUSTED: "provider_unavailable",
  PROVIDER_ENDPOINT_NOT_FOUND: "model_unavailable",
  MODEL_UNAVAILABLE: "model_unavailable",
  PROVIDER_REJECTED_INPUT: "invalid_request",
  CONTEXT_TOO_LARGE: "invalid_request",
  BASE_URL_REQUIRED: "misconfigured",
  PROVIDER_CONFIG_INVALID: "misconfigured",
  PROVIDER_SECRET_REFERENCE_MISSING: "misconfigured",
  PROVIDER_INVALID_RESPONSE: "malformed_response",
  PROVIDER_INVALID_STREAM: "stream_interrupted",
  PROVIDER_STREAM_ERROR: "stream_interrupted",
  PROVIDER_STREAM_INTERRUPTED: "stream_interrupted",
  PROVIDER_EMPTY_STREAM: "empty_response",
  PROVIDER_EMPTY_OUTPUT: "empty_response",
  PROVIDER_CANCELLED: "cancelled",
};

const RETRYABLE_CATEGORIES = new Set<ProviderErrorCategory>([
  "rate_limit",
  "timeout",
  "network",
  "provider_unavailable",
  "stream_interrupted",
]);

function safeTechnicalMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown provider failure";
  return error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|authorization))\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

export function providerErrorCategory(code: string): ProviderErrorCategory {
  return CODE_CATEGORY[code] ?? "unknown";
}

export function enrichProviderError(
  error: ProviderError,
  context: {
    provider?: ProviderTypeId | ProviderKind;
    model?: string;
    requestId?: string;
    providerRequestId?: string;
  },
): ProviderError {
  return new ProviderError(
    error.code,
    error.message,
    error.httpStatus,
    error.providerStatus,
    error.retryable,
    error.retryAfterMs,
    {
      category: error.category === "unknown" ? providerErrorCategory(error.code) : error.category,
      provider: context.provider ?? error.provider,
      model: context.model ?? error.model,
      requestId: context.requestId ?? error.requestId,
      providerRequestId: context.providerRequestId ?? error.providerRequestId,
      technicalMessage: error.technicalMessage,
      timestamp: error.timestamp,
    },
  );
}

export function normalizeUnknownProviderError(
  error: unknown,
  context: { provider?: ProviderTypeId | ProviderKind; model?: string; requestId?: string } = {},
): ProviderError {
  if (error instanceof ProviderError) return enrichProviderError(error, context);
  const technicalMessage = safeTechnicalMessage(error);
  if (/resource\s*exhausted|resourceexhausted/i.test(technicalMessage)
      && /worker\s+local\s+total\s+request\s+limit\s+reached/i.test(technicalMessage)) {
    return new ProviderError(
      "PROVIDER_CAPACITY_EXHAUSTED",
      "سعة التنفيذ لدى المزود ممتلئة مؤقتًا. لم يبدأ توليد الرد.",
      503,
      undefined,
      true,
      60_000,
      {
        category: "provider_unavailable",
        ...context,
        technicalMessage,
      },
    );
  }
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    const cancelled = error.name === "AbortError";
    return new ProviderError(
      cancelled ? "PROVIDER_CANCELLED" : "PROVIDER_TIMEOUT",
      cancelled ? "تم إلغاء طلب المزود." : "انتهت مهلة الاتصال بالمزود.",
      cancelled ? 499 : 504,
      cancelled ? undefined : 408,
      !cancelled,
      undefined,
      {
        category: cancelled ? "cancelled" : "timeout",
        ...context,
        technicalMessage: safeTechnicalMessage(error),
      },
    );
  }
  const message = error instanceof Error && /fetch|network|dns|socket|connect/i.test(error.message)
    ? "لم تصل استجابة من الخادم، لذلك لا يمكن تأكيد صحة المفتاح أو النموذج."
    : "تعذر تحديد السبب النهائي لفشل المزود.";
  const category: ProviderErrorCategory = message.startsWith("لم تصل") ? "network" : "unknown";
  return new ProviderError(
    category === "network" ? "PROVIDER_NETWORK_ERROR" : "PROVIDER_ERROR",
    message,
    502,
    undefined,
    RETRYABLE_CATEGORIES.has(category),
    undefined,
    { category, ...context, technicalMessage: safeTechnicalMessage(error) },
  );
}

export function healthStatusForProviderError(error: ProviderError): ProviderHealthStatus {
  switch (error.category === "unknown" ? providerErrorCategory(error.code) : error.category) {
    case "authentication":
    case "authorization":
      return "unauthorized";
    case "model_unavailable":
      return "model_unavailable";
    case "rate_limit":
    case "quota":
      return "rate_limited";
    case "network":
    case "timeout":
      return "network_error";
    case "misconfigured":
    case "invalid_request":
      return "misconfigured";
    case "provider_unavailable":
    case "malformed_response":
    case "empty_response":
    case "stream_interrupted":
      return "degraded";
    default:
      return "unknown";
  }
}

export function isRetryableProviderError(error: ProviderError): boolean {
  const category = error.category === "unknown" ? providerErrorCategory(error.code) : error.category;
  return error.retryable && RETRYABLE_CATEGORIES.has(category);
}
