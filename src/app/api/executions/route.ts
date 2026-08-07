import { requireSession } from "@/lib/auth/authorization";
import { executionCreateSchema, executionListQuerySchema } from "@/lib/execution/contracts";
import { ExecutionError, executionErrorHttpStatus } from "@/lib/execution/errors";
import { listExecutions } from "@/lib/execution/repository";
import { assertExecutionKernelEnabled } from "@/lib/execution/runner-registry";
import { createDiagnosticExecution } from "@/lib/execution/service";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertExecutionKernelEnabled();
    const session = await requireSession("executions:read");
    const query = executionListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const result = await listExecutions({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return apiSuccess(result.rows, requestId, 200, { pagination: result.pagination });
  } catch (error) {
    if (error instanceof ExecutionError) {
      return handleApiError(new ApiError(executionErrorHttpStatus(error.code), error.code, error.message), requestId, "/api/executions");
    }
    return handleApiError(error, requestId, "/api/executions");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertExecutionKernelEnabled();
    assertSameOrigin(request);
    const session = await requireSession("executions:run");
    await enforceRateLimit({
      scope: "execution-create",
      key: `${session.organizationId}:${session.userId}`,
      limit: 10,
      windowMs: 60_000,
    });
    const body = await parseJson(request, executionCreateSchema, 16 * 1024);
    const result = await createDiagnosticExecution({
      actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
      requestId,
      body,
    });
    return apiSuccess({
      jobId: result.job.id,
      status: result.job.status,
      duplicate: result.duplicate,
    }, requestId, result.duplicate ? 200 : 202);
  } catch (error) {
    if (error instanceof ExecutionError) {
      return handleApiError(new ApiError(executionErrorHttpStatus(error.code), error.code, error.message), requestId, "/api/executions");
    }
    return handleApiError(error, requestId, "/api/executions");
  }
}
