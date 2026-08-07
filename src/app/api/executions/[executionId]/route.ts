import { requireSession } from "@/lib/auth/authorization";
import { ExecutionError, executionErrorHttpStatus } from "@/lib/execution/errors";
import { executionDetails } from "@/lib/execution/repository";
import { assertExecutionKernelEnabled } from "@/lib/execution/runner-registry";
import { ApiError, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";
import { uuidSchema } from "@/lib/http/contracts";

export async function GET(request: Request, context: { params: Promise<{ executionId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertExecutionKernelEnabled();
    const session = await requireSession("executions:read");
    const executionId = uuidSchema.parse((await context.params).executionId);
    const result = await executionDetails(
      { organizationId: session.organizationId, userId: session.userId, role: session.role },
      executionId,
    );
    return apiSuccess({
      id: result.job.id,
      kind: result.job.kind,
      status: result.job.status,
      runnerKind: result.workspace.runnerKind,
      limits: result.workspace.limits,
      networkPolicy: result.workspace.networkPolicy,
      resultSummary: result.job.resultSummary,
      errorCode: result.job.errorCode,
      errorReference: result.job.errorReference,
      attempts: { current: result.job.attemptCount, maximum: result.job.maxAttempts },
      cancelRequestedAt: result.job.cancelRequestedAt,
      startedAt: result.job.startedAt,
      completedAt: result.job.completedAt,
      createdAt: result.job.createdAt,
      updatedAt: result.job.updatedAt,
      usage: result.usage,
      steps: result.steps,
      artifacts: result.artifacts.map((artifact) => ({
        ...artifact,
        downloadUrl: `/api/executions/${executionId}/artifacts?artifactId=${artifact.id}`,
      })),
      recentEvents: result.recentEvents,
    }, requestId);
  } catch (error) {
    if (error instanceof ExecutionError) {
      return handleApiError(new ApiError(executionErrorHttpStatus(error.code), error.code, error.message), requestId, "/api/executions/[executionId]");
    }
    return handleApiError(error, requestId, "/api/executions/[executionId]");
  }
}
