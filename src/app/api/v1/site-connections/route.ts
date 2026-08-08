import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { siteConnectionCreateSchema } from "@/lib/site-connections/contracts";
import { createSiteConnection, listSiteConnections } from "@/lib/site-connections/service";
import { ApiError } from "@/lib/http/api";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

function actorUserId(value: string | null) {
  if (!value) throw new ApiError(409, "API_ACTOR_REQUIRED", "يتطلب هذا الإجراء مفتاح منصة مرتبطًا بمستخدم منشئ.");
  return value;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "integrations:read");
    const rows = await listSiteConnections(principal.organizationId);
    return apiSuccess({ siteConnections: rows }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/site-connections");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "integrations:write");
    await enforceRateLimit({ scope: "v1-site-connections:create", key: `${principal.organizationId}:${requestClientKey(request, principal.principalId)}`, limit: 20, windowMs: 60 * 60_000 });
    const body = await parseJson(request, siteConnectionCreateSchema, 32 * 1024);
    if (body.connectorType === "oauth" || body.connectorType === "browser") {
      throw new ApiError(422, "INTERACTIVE_AUTH_REQUIRED", "ابدأ OAuth أو جلسة المتصفح من واجهة المستخدم الموثوقة.");
    }
    const result = await createSiteConnection({
      organizationId: principal.organizationId,
      userId: actorUserId(principal.userId),
      requestId,
      body,
    });
    return apiSuccess(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/site-connections");
  }
}
