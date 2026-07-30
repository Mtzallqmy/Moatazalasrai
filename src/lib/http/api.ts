import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { errorDescriptor } from "@/contracts/errors";
import { ProviderError } from "@/lib/providers/types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[a-zA-Z0-9._:-]{1,100}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function responseHeaders(requestId: string) {
  return {
    "cache-control": "no-store, max-age=0",
    "x-request-id": requestId,
  };
}

export function apiSuccess<T>(data: T, requestId: string, status = 200, meta?: Record<string, unknown>) {
  return NextResponse.json(
    { success: true as const, data, meta: { requestId, ...meta } },
    { status, headers: responseHeaders(requestId) },
  );
}

export function apiFailure(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) {
  const descriptor = errorDescriptor(code);
  return NextResponse.json(
    {
      success: false as const,
      error: {
        code,
        message,
        requestId,
        ...(descriptor ? {
          retryable: descriptor.retryable,
          action: { ar: descriptor.actionAr, en: descriptor.actionEn },
          messageEn: descriptor.messageEn,
        } : {}),
        ...(details === undefined ? {} : { details }),
      },
    },
    { status, headers: responseHeaders(requestId) },
  );
}

export function handleApiError(error: unknown, requestId: string, route: string) {
  if (error instanceof ApiError) {
    return apiFailure(error.status, error.code, error.message, requestId, error.details);
  }
  if (error instanceof ProviderError) {
    return apiFailure(error.httpStatus, error.code, error.message, requestId, {
      providerStatus: error.providerStatus,
      retryAfterMs: error.retryAfterMs,
    });
  }
  if (error instanceof ZodError) {
    return apiFailure(
      400,
      "VALIDATION_ERROR",
      "تعذر قبول البيانات المرسلة. راجع الحقول وحاول مجددًا.",
      requestId,
      error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })),
    );
  }
  console.error(JSON.stringify({
    level: "error",
    event: "api.unhandled_error",
    route,
    requestId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  }));
  return apiFailure(500, "INTERNAL_ERROR", "حدث خطأ غير متوقع. استخدم معرّف الطلب عند التواصل مع الدعم.", requestId);
}

export async function parseJson<T>(request: Request, schema: ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "حجم الطلب أكبر من الحد المسموح.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "حجم الطلب أكبر من الحد المسموح.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "صيغة JSON غير صالحة.");
  }
  return schema.parse(value);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin) {
    if (fetchSite === "same-origin") return;
    throw new ApiError(403, "CSRF_REJECTED", "تعذر التحقق من مصدر الطلب.");
  }

  const requestUrl = new URL(request.url);
  const configured = process.env.APP_URL?.trim();
  const expected = configured ? new URL(configured).origin : requestUrl.origin;
  if (new URL(origin).origin !== expected) {
    throw new ApiError(403, "CSRF_REJECTED", "تم رفض الطلب لأن مصدره غير موثوق.");
  }
}
