import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentTeamRuns, agentTeamRunSteps } from "@/db/schema";
import { executeAgentTeam } from "@/lib/agents/team-runtime";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, ApiError, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

const schema = z.object({
  teamId: z.string().uuid(),
  input: z.string().trim().min(1).max(20_000),
}).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "teams:read");
    const runs = await db().select().from(agentTeamRuns)
      .where(eq(agentTeamRuns.organizationId, principal.organizationId))
      .orderBy(desc(agentTeamRuns.createdAt)).limit(50);
    const steps = runs.length ? await db().select().from(agentTeamRunSteps)
      .where(eq(agentTeamRunSteps.organizationId, principal.organizationId))
      .orderBy(agentTeamRunSteps.position) : [];
    return apiSuccess({
      runs: runs.map((run) => ({ ...run, steps: steps.filter((step) => step.teamRunId === run.id) })),
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/team-runs");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "teams:write");
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "أرسل Idempotency-Key صالحًا لتشغيل الفريق.");
    }
    const body = await parseJson(request, schema, 24 * 1024);
    const run = await executeAgentTeam({
      organizationId: principal.organizationId,
      teamId: body.teamId,
      prompt: body.input,
      requestId: idempotencyKey,
      userId: principal.userId,
    });
    return apiSuccess({ run }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/team-runs");
  }
}
