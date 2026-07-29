import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { providerValidationSchema } from "@/lib/http/contracts";
import { validateProvider } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("providers:manage");
    await enforceRateLimit({
      scope: "provider.validate",
      key: `${session.organizationId}:${session.userId}`,
      limit: 12,
      windowMs: 10 * 60_000,
    });
    const body = await parseJson(request, providerValidationSchema, 16 * 1024);
    const result = await validateProvider({ ...body, requestId, signal: request.signal });
    return apiSuccess(result, requestId);
  } catch (error) {
    if (error instanceof ProviderError) {
      error = new ApiError(error.httpStatus, error.code, error.message, { providerStatus: error.providerStatus });
    }
    return handleApiError(error, requestId, "/api/dashboard/providers/validate");
  }
}
