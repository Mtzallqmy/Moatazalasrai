import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentTeamRunsRuntime, agentTeamRunStepsRuntime } from "@/db/agent-runtime-schema";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, ApiError, getRequestId, handleApiError } from "@/lib/http/api";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "teams:read");
    const { id } = await context.params;
    const [run] = await db().select().from(agentTeamRunsRuntime).where(and(
      eq(agentTeamRunsRuntime.id, id),
      eq(agentTeamRunsRuntime.organizationId, principal.organizationId),
    )).limit(1);
    if (!run) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");
    const steps = await db().select().from(agentTeamRunStepsRuntime).where(and(
      eq(agentTeamRunStepsRuntime.teamRunId, run.id),
      eq(agentTeamRunStepsRuntime.organizationId, principal.organizationId),
    )).orderBy(asc(agentTeamRunStepsRuntime.position));
    return apiSuccess({ run: { ...run, steps } }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/team-runs/:id");
  }
}
