import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, getRequestId, handleApiError, parseJson, ApiError } from "@/lib/http/api";
import { browserTaskCreateSchema } from "@/lib/browser/contracts";
import { createBrowserTask, listBrowserTasks } from "@/lib/browser/task-service";
import { enforceRateLimit, requestClientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "runs:read");
    const url = new URL(request.url);
    const rows = await listBrowserTasks({
      organizationId: principal.organizationId,
      userId: principal.userId ?? principal.principalId,
      role: principal.role ?? "admin",
      status: url.searchParams.get("status") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
    return apiSuccess({ browserTasks: rows }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/browser-tasks");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "runs:write");
    if (!principal.userId) throw new ApiError(409, "API_ACTOR_REQUIRED", "يتطلب تشغيل مهمة المتصفح مفتاح منصة مرتبطًا بمستخدم منشئ.");
    await enforceRateLimit({ scope: "v1-browser-tasks:create", key: `${principal.organizationId}:${requestClientKey(request, principal.principalId)}`, limit: 30, windowMs: 15 * 60_000 });
    const body = await parseJson(request, browserTaskCreateSchema, 16 * 1024);
    const result = await createBrowserTask({
      organizationId: principal.organizationId,
      userId: principal.userId,
      requestId,
      body,
    });
    return apiSuccess(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/browser-tasks");
  }
}
