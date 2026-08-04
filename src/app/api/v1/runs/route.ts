import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { executeAgentRun, listOrganizationRuns } from "@/lib/agents/runtime";
import { apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { platformRunSchema } from "@/lib/http/contracts";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "runs:read");
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const result = await listOrganizationRuns({
      organizationId: principal.organizationId,
      userId: principal.userId ?? undefined,
      page: 1,
      limit: Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 100),
    });
    return apiSuccess({ runs: result.rows, total: result.total }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/runs");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "مفتاح المنصة غير صالح.", requestId);
    requireApiScope(principal, "runs:write");
    await enforceRateLimit({
      scope: "api.agent_run",
      key: `${principal.organizationId}:${principal.principalId}`,
      limit: 60,
      windowMs: 60_000,
    });
    const body = await parseJson(request, platformRunSchema);
    const run = await executeAgentRun({
      organizationId: principal.organizationId,
      userId: principal.userId ?? undefined,
      agentId: body.agentId,
      message: body.input,
      conversationId: body.conversationId,
      requestId,
    });
    return apiSuccess({ run }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/runs");
  }
}
