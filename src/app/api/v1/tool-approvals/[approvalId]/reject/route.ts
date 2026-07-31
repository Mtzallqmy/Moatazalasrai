import { z } from "zod";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { decideToolApproval } from "@/lib/ai-sdk/approvals";
import { ApiError, apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enqueueAgentRunResume } from "@/worker/queue";

const schema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "runs:write");
    if (!principal.userId) throw new ApiError(403, "USER_DECISION_REQUIRED", "يتطلب قرار الموافقة هوية مستخدم داخل المؤسسة.");
    const { approvalId } = await context.params;
    const body = await parseJson(request, schema, 4 * 1024);
    const approval = await decideToolApproval({
      organizationId: principal.organizationId,
      approvalId,
      userId: principal.userId,
      approved: false,
      reason: body.reason,
    });
    const queued = await enqueueAgentRunResume({ organizationId: principal.organizationId, approvalId });
    return apiSuccess({ approval, resumeJobId: queued.jobId }, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/tool-approvals/:approvalId/reject");
  }
}
