import { requireSession } from "@/lib/auth/authorization";
import { requestExecutionCancellation } from "@/lib/execution/cancellation-service";
import { ExecutionError, executionErrorHttpStatus } from "@/lib/execution/errors";
import { assertExecutionKernelEnabled } from "@/lib/execution/runner-registry";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ executionId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertExecutionKernelEnabled();
    assertSameOrigin(request);
    const session = await requireSession("executions:run");
    const executionId = uuidSchema.parse((await context.params).executionId);
    await enforceRateLimit({
      scope: "execution-cancel",
      key: `${session.organizationId}:${session.userId}:${executionId}`,
      limit: 10,
      windowMs: 60_000,
    });
    const result = await requestExecutionCancellation({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      jobId: executionId,
      requestId,
    });
    return apiSuccess({
      jobId: result.job.id,
      status: result.job.status,
      accepted: result.accepted,
      terminal: result.terminal,
    }, requestId, result.accepted ? 202 : 200);
  } catch (error) {
    if (error instanceof ExecutionError) {
      return handleApiError(new ApiError(executionErrorHttpStatus(error.code), error.code, error.message), requestId, "/api/executions/[executionId]/cancel");
    }
    return handleApiError(error, requestId, "/api/executions/[executionId]/cancel");
  }
}
