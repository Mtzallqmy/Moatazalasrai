import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { cancelAgentTeamRun } from "@/lib/agents/team-runtime";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, getRequestId, handleApiError } from "@/lib/http/api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "teams:write");
    const { id } = await context.params;
    const run = await cancelAgentTeamRun(principal.organizationId, id);
    await db().insert(auditLogs).values({
      organizationId: principal.organizationId,
      actorType: principal.kind,
      actorId: principal.principalId,
      action: "agent_team_run.cancel_requested",
      resourceType: "agent_team_run",
      resourceId: id,
      metadata: { status: run.status, requestId },
    });
    return apiSuccess({ run }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/team-runs/:id/cancel");
  }
}
