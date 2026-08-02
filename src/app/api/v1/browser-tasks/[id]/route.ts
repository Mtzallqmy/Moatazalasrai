import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { cancelBrowserTask, getBrowserTask } from "@/lib/browser/task-service";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "runs:read");
    const { id } = await context.params;
    const result = await getBrowserTask({
      organizationId: principal.organizationId,
      userId: principal.userId ?? principal.principalId,
      role: principal.role ?? "admin",
      browserTaskId: id,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/browser-tasks/:id");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "runs:write");
    if (!principal.userId) throw new ApiError(409, "API_ACTOR_REQUIRED", "يتطلب إلغاء المهمة مفتاح منصة مرتبطًا بمستخدم منشئ.");
    const { id } = await context.params;
    const result = await cancelBrowserTask({
      organizationId: principal.organizationId,
      userId: principal.userId,
      role: principal.role ?? "admin",
      browserTaskId: id,
      requestId,
    });
    return apiSuccess(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/browser-tasks/:id");
  }
}
