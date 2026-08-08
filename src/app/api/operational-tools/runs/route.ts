import { requireSession } from "@/lib/auth/authorization";
import { ApiError, apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { operationalToolRunRequestSchema } from "@/lib/tools/runtime-contracts";
import { createOperationalToolRun } from "@/lib/tools/runtime-service";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession("tools:run");
    await enforceRateLimit({ scope: "operational-tool-run", key: `${session.organizationId}:${session.userId}`, limit: 12, windowMs: 60_000 });
    const body = await parseJson(request, operationalToolRunRequestSchema, 1024 * 1024);
    const result = await createOperationalToolRun({ actor: { organizationId: session.organizationId, userId: session.userId, role: session.role }, requestId, body });
    if (!result.run) throw new ApiError(500, "TOOL_RUN_CREATE_FAILED", "تعذر إنشاء Tool Run.");
    return apiSuccess({ toolRunId: result.run.id, executionJobId: result.job.id, status: result.run.status, duplicate: result.duplicate }, requestId, result.duplicate ? 200 : 202);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TOOL_NOT_RUNNABLE:")) {
      return handleApiError(new ApiError(409, "TOOL_NOT_RUNNABLE", error.message.slice("TOOL_NOT_RUNNABLE:".length)), requestId, "/api/operational-tools/runs");
    }
    return handleApiError(error, requestId, "/api/operational-tools/runs");
  }
}
