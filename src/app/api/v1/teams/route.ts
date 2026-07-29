import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentTeamMembers, agentTeams, agents } from "@/db/schema";
import { authenticateApiKey, requireApiScope } from "@/lib/auth/api-key";
import { apiFailure, apiSuccess, ApiError, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  supervisorAgentId: z.string().uuid(),
  memberAgentIds: z.array(z.string().uuid()).min(1).max(5),
  maxParallelWorkers: z.number().int().min(1).max(5).default(3),
}).strict();

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "teams:read");
    const teams = await db().select().from(agentTeams).where(eq(agentTeams.organizationId, principal.organizationId))
      .orderBy(desc(agentTeams.updatedAt));
    const members = teams.length ? await db().select().from(agentTeamMembers)
      .where(inArray(agentTeamMembers.teamId, teams.map((team) => team.id))) : [];
    return apiSuccess({
      teams: teams.map((team) => ({ ...team, members: members.filter((member) => member.teamId === team.id) })),
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/teams");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await authenticateApiKey(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "رمز الوصول غير صالح.", requestId);
    requireApiScope(principal, "teams:write");
    const body = await parseJson(request, createSchema, 16 * 1024);
    const ids = [...new Set([body.supervisorAgentId, ...body.memberAgentIds])];
    const available = await db().select({ id: agents.id }).from(agents).where(and(
      eq(agents.organizationId, principal.organizationId),
      eq(agents.status, "published"),
      inArray(agents.id, ids),
    ));
    if (available.length !== ids.length) throw new ApiError(422, "TEAM_AGENT_UNAVAILABLE", "أحد وكلاء الفريق غير موجود أو غير منشور.");
    const team = await db().transaction(async (tx) => {
      const [created] = await tx.insert(agentTeams).values({
        organizationId: principal.organizationId,
        name: body.name,
        description: body.description,
        supervisorAgentId: body.supervisorAgentId,
        maxParallelWorkers: body.maxParallelWorkers,
      }).returning();
      if (!created) throw new Error("TEAM_CREATE_FAILED");
      await tx.insert(agentTeamMembers).values(ids.map((agentId, position) => ({
        organizationId: principal.organizationId,
        teamId: created.id,
        agentId,
        role: agentId === body.supervisorAgentId ? "supervisor" : "worker",
        position,
      })));
      return created;
    });
    return apiSuccess({ team }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId, "/api/v1/teams");
  }
}
