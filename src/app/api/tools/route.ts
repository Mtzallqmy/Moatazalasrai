import { aiFeatureEnabled } from "@/ai/config";
import { platformTools } from "@/ai/tools/platform";
import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (!aiFeatureEnabled("TOOLS")) throw new ApiError(404, "FEATURE_DISABLED", "ميزة الأدوات غير مفعلة.");
    const session = await requireSession("agents:read");
    const rows = platformTools.definitions().filter((tool) => tool.requiredRoles.includes(session.role));
    return apiSuccess(rows, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/tools"); }
}
