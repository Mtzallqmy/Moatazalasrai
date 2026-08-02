import { z } from "zod";
import { requireSession } from "@/lib/auth/authorization";
import {
  decideToolApproval,
  listPendingToolApprovals,
} from "@/lib/ai-sdk/approvals";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import {
  enqueueAgentRunResume,
  enqueueBrowserResume,
  enqueueSandboxResume,
} from "@/worker/queue";

const schema = z.object({
  approvalId: z.string().min(1).max(200),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(500).optional(),
}).strict();

async function approvalSession() {
  const session = await requireSession();
  if (!["owner", "admin", "developer", "operator"].includes(session.role)) {
    throw new ApiError(403, "FORBIDDEN", "لا تملك صلاحية مراجعة الموافقات.");
  }
  return session;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await approvalSession();
    const rows = await listPendingToolApprovals(session.organizationId);
    return apiSuccess(rows, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/tool-approvals");
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await approvalSession();
    const body = await parseJson(request, schema, 4096);
    const result = await decideToolApproval({
      organizationId: session.organizationId,
      approvalId: body.approvalId,
      userId: session.userId,
      approved: body.decision === "approved",
      reason: body.reason,
    });

    const queued = result.sandboxExecutionId
      ? await enqueueSandboxResume({
        organizationId: session.organizationId,
        approvalId: body.approvalId,
        executionId: result.sandboxExecutionId,
      })
      : result.browserTaskId
        ? await enqueueBrowserResume({
          organizationId: session.organizationId,
          approvalId: body.approvalId,
          browserTaskId: result.browserTaskId,
        })
        : await enqueueAgentRunResume({
          organizationId: session.organizationId,
          approvalId: body.approvalId,
        });
    return apiSuccess({ approval: result, resumeJobId: queued.jobId }, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId, "/api/tool-approvals");
  }
}
