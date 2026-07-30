import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { listPendingToolApprovals } from "@/lib/ai-sdk/approvals";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "runs:read");
    const approvals = await listPendingToolApprovals(principal.organizationId);
    return apiSuccess({ approvals }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/tool-approvals");
  }
}
