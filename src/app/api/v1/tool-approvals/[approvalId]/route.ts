import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { getToolApproval } from "@/lib/ai-sdk/approvals";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "runs:read");
    const { approvalId } = await context.params;
    const approval = await getToolApproval(principal.organizationId, approvalId);
    return apiSuccess({ approval }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/tool-approvals/:approvalId");
  }
}
