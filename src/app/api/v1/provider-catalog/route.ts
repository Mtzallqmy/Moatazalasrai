import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { publicProviderCatalog } from "@/lib/providers/catalog";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "providers:read");
    return apiSuccess({ providers: publicProviderCatalog() }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/provider-catalog");
  }
}
