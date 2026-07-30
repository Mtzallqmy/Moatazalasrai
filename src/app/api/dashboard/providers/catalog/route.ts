import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { publicProviderCatalog } from "@/lib/providers/catalog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireSession("providers:read");
    return apiSuccess({ providers: publicProviderCatalog() }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/providers/catalog");
  }
}
