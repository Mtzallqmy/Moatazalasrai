import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { deleteSiteConnection, listSiteConnections } from "@/lib/site-connections/service";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "integrations:read");
    const { id } = await context.params;
    const connection = (await listSiteConnections(principal.organizationId)).find((row) => row.id === id);
    if (!connection) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "الاتصال غير موجود.");
    return apiSuccess(connection, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/site-connections/:id");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "integrations:write");
    if (!principal.userId) throw new ApiError(409, "API_ACTOR_REQUIRED", "يتطلب هذا الإجراء مفتاح منصة مرتبطًا بمستخدم منشئ.");
    const { id } = await context.params;
    const result = await deleteSiteConnection({
      organizationId: principal.organizationId,
      userId: principal.userId,
      connectionId: id,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/site-connections/:id");
  }
}
