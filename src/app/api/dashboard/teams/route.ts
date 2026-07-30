import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  agentTeamRunsRuntime,
  agentTeamRunStepsRuntime,
} from "@/db/agent-runtime-schema";
import { agentTeamMembers, agentTeams, agents, auditLogs } from "@/db/schema";
import {
  cancelAgentTeamRun,
  createAgentTeamRun,
  retryAgentTeamRun,
} from "@/lib/agents/team-runtime";
import { requireSession } from "@/lib/auth/authorization";
import { apiSuccess, ApiError, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional(),
    supervisorAgentId: z.string().uuid(),
    memberAgentIds: z.array(z.string().uuid()).min(1).max(5),
  }).strict(),
  z.object({
    action: z.literal("run"),
    teamId: z.string().uuid(),
    input: z.string().trim().min(1).max(20_000),
  }).strict(),
  z.object({ action: z.literal("cancel"), teamRunId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("retry"), teamRunId: z.string().uuid() }).strict(),
]);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession("agents:read");
    const [agentRows, teams, runs] = await Promise.all([
      db().select({ id: agents.id, name: agents.name, description: agents.description })
        .from(agents).where(and(eq(agents.organizationId, session.organizationId), eq(agents.status, "published")))
        .orderBy(asc(agents.name)),
      db().select().from(agentTeams).where(eq(agentTeams.organizationId, session.organizationId))
        .orderBy(desc(agentTeams.updatedAt)),
      db().select().from(agentTeamRunsRuntime).where(eq(agentTeamRunsRuntime.organizationId, session.organizationId))
        .orderBy(desc(agentTeamRunsRuntime.createdAt)).limit(20),
    ]);
    const [members, steps] = await Promise.all([
      teams.length ? db().select().from(agentTeamMembers).where(and(
        eq(agentTeamMembers.organizationId, session.organizationId),
        inArray(agentTeamMembers.teamId, teams.map((team) => team.id)),
      )) : Promise.resolve([]),
      runs.length ? db().select().from(agentTeamRunStepsRuntime).where(and(
        eq(agentTeamRunStepsRuntime.organizationId, session.organizationId),
        inArray(agentTeamRunStepsRuntime.teamRunId, runs.map((run) => run.id)),
      )).orderBy(agentTeamRunStepsRuntime.position) : Promise.resolve([]),
    ]);
    return apiSuccess({
      agents: agentRows,
      teams: teams.map((team) => ({ ...team, members: members.filter((member) => member.teamId === team.id) })),
      runs: runs.map((run) => ({
        ...run,
        steps: steps.filter((step) => step.teamRunId === run.id),
      })),
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/teams");
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const body = await parseJson(request, actionSchema, 24 * 1024);
    if (body.action === "create") {
      const session = await requireSession("agents:manage");
      const ids = [...new Set([body.supervisorAgentId, ...body.memberAgentIds])];
      const available = await db().select({ id: agents.id }).from(agents).where(and(
        eq(agents.organizationId, session.organizationId),
        eq(agents.status, "published"),
        inArray(agents.id, ids),
      ));
      if (available.length !== ids.length) throw new ApiError(422, "TEAM_AGENT_UNAVAILABLE", "أحد وكلاء الفريق غير موجود أو غير منشور.");
      const team = await db().transaction(async (tx) => {
        const [created] = await tx.insert(agentTeams).values({
          organizationId: session.organizationId,
          name: body.name,
          description: body.description,
          supervisorAgentId: body.supervisorAgentId,
          maxParallelWorkers: Math.min(3, Math.max(1, ids.length - 1)),
        }).returning();
        if (!created) throw new Error("TEAM_CREATE_FAILED");
        await tx.insert(agentTeamMembers).values(ids.map((agentId, position) => ({
          organizationId: session.organizationId,
          teamId: created.id,
          agentId,
          role: agentId === body.supervisorAgentId ? "supervisor" : "worker",
          position,
        })));
        await tx.insert(auditLogs).values({
          organizationId: session.organizationId,
          actorType: "user",
          actorId: session.userId,
          action: "agent_team.created",
          resourceType: "agent_team",
          resourceId: created.id,
          metadata: { requestId, memberCount: ids.length },
        });
        return created;
      });
      return apiSuccess({ team }, requestId, 201);
    }

    const session = await requireSession(body.action === "run" ? "agents:run" : "agents:manage");
    if (body.action === "run") {
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? crypto.randomUUID();
      const run = await createAgentTeamRun({
        organizationId: session.organizationId,
        teamId: body.teamId,
        prompt: body.input,
        requestId: idempotencyKey,
        userId: session.userId,
      });
      await db().insert(auditLogs).values({
        organizationId: session.organizationId,
        actorType: "user",
        actorId: session.userId,
        action: "agent_team_run.queued",
        resourceType: "agent_team_run",
        resourceId: run.id,
        metadata: { requestId, teamId: body.teamId, idempotencyKey },
      });
      const response = apiSuccess({ run }, requestId, 202);
      response.headers.set("location", `/api/v1/team-runs/${run.id}`);
      response.headers.set("retry-after", "2");
      return response;
    }

    const run = body.action === "cancel"
      ? await cancelAgentTeamRun(session.organizationId, body.teamRunId)
      : await retryAgentTeamRun(session.organizationId, body.teamRunId);
    await db().insert(auditLogs).values({
      organizationId: session.organizationId,
      actorType: "user",
      actorId: session.userId,
      action: body.action === "cancel" ? "agent_team_run.cancel_requested" : "agent_team_run.retry_queued",
      resourceType: "agent_team_run",
      resourceId: body.teamRunId,
      metadata: { requestId },
    });
    return apiSuccess({ run }, requestId, body.action === "retry" ? 202 : 200);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/teams");
  }
}
