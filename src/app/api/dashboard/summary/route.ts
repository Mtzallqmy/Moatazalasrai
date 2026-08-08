import { requireSession } from "@/lib/auth/authorization";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { loadDashboardSummary } from "@/lib/dashboard/summary";
import { apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession();
    const permissions = await loadCustomPermissions(session.organizationId, session.userId);
    const data = await loadDashboardSummary({
      organizationId: session.organizationId,
      userId: session.userId,
      role: session.role,
      permissions,
    });
    return apiSuccess(data, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/summary");
  }
}
