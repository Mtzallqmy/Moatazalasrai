import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentTeamRunsRuntime, agentTeamRunStepsRuntime } from "@/db/agent-runtime-schema";
import { agentTeamMembers, agentTeams, agents } from "@/db/schema";
import {
  cancelAgentTeamRun,
  createAgentTeamRun,
  retryAgentTeamRun,
} from "@/lib/agents/team-runtime";
import {
  decideToolApproval,
  getToolApproval,
  listPendingToolApprovals,
} from "@/lib/ai-sdk/approvals";
import { assertUserPermission, userOrganizationRole } from "@/lib/auth/user-authorization";
import { listBrowserTasks } from "@/lib/browser/task-service";
import { ApiError } from "@/lib/http/api";
import { testCurrentAuthenticatedRunner } from "@/lib/platform/runner-auth-health";
import { listSandboxExecutions, listSandboxWorkspaces } from "@/lib/sandbox/service";
import {
  enqueueAgentRunResume,
  enqueueBrowserResume,
  enqueueSandboxResume,
} from "@/worker/queue";

const PAGE_SIZE = 5;

type TeamMemberSummary = {
  teamId?: string;
  agentId: string;
  role: string;
  position: number;
  agentName: string;
  agentStatus: "draft" | "published" | "archived";
};

function teamReadiness(input: {
  supervisor: { id: string; name: string; status: "draft" | "published" | "archived" } | undefined;
  supervisorAgentId: string;
  members: TeamMemberSummary[];
}) {
  const workers = input.members.filter((member) => member.agentId !== input.supervisorAgentId);
  return {
    workers,
    ready: input.supervisor?.status === "published"
      && workers.length > 0
      && workers.every((member) => member.agentStatus === "published"),
  };
}

export async function listChannelTeams(input: {
  organizationId: string;
  userId: string;
  page?: number;
}) {
  await assertUserPermission({ ...input, permission: "agents:read" });
  const page = Math.max(1, input.page ?? 1);
  const where = and(eq(agentTeams.organizationId, input.organizationId), eq(agentTeams.enabled, true));
  const [teams, totals] = await Promise.all([
    db().select({
      id: agentTeams.id,
      name: agentTeams.name,
      description: agentTeams.description,
      supervisorAgentId: agentTeams.supervisorAgentId,
      maxParallelWorkers: agentTeams.maxParallelWorkers,
      updatedAt: agentTeams.updatedAt,
    }).from(agentTeams).where(where).orderBy(desc(agentTeams.updatedAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().select({ value: count() }).from(agentTeams).where(where),
  ]);
  const members: TeamMemberSummary[] = teams.length
    ? await db().select({
        teamId: agentTeamMembers.teamId,
        agentId: agentTeamMembers.agentId,
        role: agentTeamMembers.role,
        position: agentTeamMembers.position,
        agentName: agents.name,
        agentStatus: agents.status,
      }).from(agentTeamMembers)
        .innerJoin(agents, eq(agents.id, agentTeamMembers.agentId))
        .where(and(
          eq(agentTeamMembers.organizationId, input.organizationId),
          inArray(agentTeamMembers.teamId, teams.map((team) => team.id)),
        )).orderBy(asc(agentTeamMembers.position))
    : [];
  const supervisors = teams.length
    ? await db().select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(and(
        eq(agents.organizationId, input.organizationId),
        inArray(agents.id, teams.map((team) => team.supervisorAgentId)),
      ))
    : [];
  const supervisorById = new Map(supervisors.map((supervisor) => [supervisor.id, supervisor]));
  const total = Number(totals[0]?.value ?? 0);
  return {
    rows: teams.map((team) => {
      const supervisor = supervisorById.get(team.supervisorAgentId);
      const readiness = teamReadiness({
        supervisor,
        supervisorAgentId: team.supervisorAgentId,
        members: members.filter((member) => member.teamId === team.id),
      });
      return {
        ...team,
        supervisor: supervisor ?? null,
        members: readiness.workers,
        ready: readiness.ready,
      };
    }),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  };
}

export async function getChannelTeam(input: {
  organizationId: string;
  userId: string;
  teamId: string;
}) {
  await assertUserPermission({ ...input, permission: "agents:read" });
  const [team] = await db().select().from(agentTeams).where(and(
    eq(agentTeams.id, input.teamId),
    eq(agentTeams.organizationId, input.organizationId),
    eq(agentTeams.enabled, true),
  )).limit(1);
  if (!team) throw new ApiError(404, "AGENT_TEAM_NOT_FOUND", "فريق الوكلاء غير موجود أو معطل.");
  const [members, supervisorRows] = await Promise.all([
    db().select({
      agentId: agentTeamMembers.agentId,
      role: agentTeamMembers.role,
      position: agentTeamMembers.position,
      agentName: agents.name,
      agentStatus: agents.status,
    }).from(agentTeamMembers)
      .innerJoin(agents, eq(agents.id, agentTeamMembers.agentId))
      .where(and(
        eq(agentTeamMembers.organizationId, input.organizationId),
        eq(agentTeamMembers.teamId, team.id),
      )).orderBy(asc(agentTeamMembers.position)),
    db().select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(and(
      eq(agents.organizationId, input.organizationId),
      eq(agents.id, team.supervisorAgentId),
    )).limit(1),
  ]);
  const supervisor = supervisorRows[0];
  const readiness = teamReadiness({ supervisor, supervisorAgentId: team.supervisorAgentId, members });
  return {
    ...team,
    supervisor: supervisor ?? null,
    members: readiness.workers,
    ready: readiness.ready,
  };
}

export async function createChannelTeamRun(input: {
  organizationId: string;
  userId: string;
  teamId: string;
  prompt: string;
  requestId: string;
}) {
  await assertUserPermission({ ...input, permission: "agents:run" });
  const team = await getChannelTeam(input);
  if (!team.ready) {
    const reason = team.supervisor?.status !== "published"
      ? "وكيل الإشراف غير منشور."
      : team.members.length === 0
        ? "لا يوجد وكيل عامل في الفريق."
        : "يوجد وكيل عامل غير منشور.";
    throw new ApiError(422, "TEAM_NOT_READY", `فريق الوكلاء غير جاهز: ${reason}`);
  }
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 20_000) throw new ApiError(422, "TEAM_INPUT_INVALID", "مهمة الفريق مطلوبة ويجب ألا تتجاوز 20000 حرف.");
  return createAgentTeamRun({
    organizationId: input.organizationId,
    teamId: input.teamId,
    prompt,
    requestId: input.requestId,
    userId: input.userId,
  });
}

export async function listChannelTeamRuns(input: {
  organizationId: string;
  userId: string;
  page?: number;
}) {
  await assertUserPermission({ ...input, permission: "runs:read" });
  const page = Math.max(1, input.page ?? 1);
  const where = eq(agentTeamRunsRuntime.organizationId, input.organizationId);
  const [rows, totals] = await Promise.all([
    db().select({
      id: agentTeamRunsRuntime.id,
      teamId: agentTeamRunsRuntime.teamId,
      teamName: agentTeams.name,
      status: agentTeamRunsRuntime.status,
      errorCode: agentTeamRunsRuntime.errorCode,
      attempts: agentTeamRunsRuntime.attempts,
      createdAt: agentTeamRunsRuntime.createdAt,
      updatedAt: agentTeamRunsRuntime.updatedAt,
    }).from(agentTeamRunsRuntime)
      .leftJoin(agentTeams, eq(agentTeams.id, agentTeamRunsRuntime.teamId))
      .where(where).orderBy(desc(agentTeamRunsRuntime.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().select({ value: count() }).from(agentTeamRunsRuntime).where(where),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  return { rows, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total };
}

export async function getChannelTeamRun(input: {
  organizationId: string;
  userId: string;
  runId: string;
}) {
  await assertUserPermission({ ...input, permission: "runs:read" });
  const [run] = await db().select({
    id: agentTeamRunsRuntime.id,
    teamId: agentTeamRunsRuntime.teamId,
    teamName: agentTeams.name,
    status: agentTeamRunsRuntime.status,
    input: agentTeamRunsRuntime.input,
    output: agentTeamRunsRuntime.output,
    errorCode: agentTeamRunsRuntime.errorCode,
    attempts: agentTeamRunsRuntime.attempts,
    createdAt: agentTeamRunsRuntime.createdAt,
    updatedAt: agentTeamRunsRuntime.updatedAt,
  }).from(agentTeamRunsRuntime)
    .leftJoin(agentTeams, eq(agentTeams.id, agentTeamRunsRuntime.teamId))
    .where(and(
      eq(agentTeamRunsRuntime.id, input.runId),
      eq(agentTeamRunsRuntime.organizationId, input.organizationId),
    )).limit(1);
  if (!run) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");
  const steps = await db().select({
    id: agentTeamRunStepsRuntime.id,
    position: agentTeamRunStepsRuntime.position,
    status: agentTeamRunStepsRuntime.status,
    errorCode: agentTeamRunStepsRuntime.errorCode,
    startedAt: agentTeamRunStepsRuntime.startedAt,
    completedAt: agentTeamRunStepsRuntime.completedAt,
  }).from(agentTeamRunStepsRuntime).where(and(
    eq(agentTeamRunStepsRuntime.organizationId, input.organizationId),
    eq(agentTeamRunStepsRuntime.teamRunId, run.id),
  )).orderBy(agentTeamRunStepsRuntime.position);
  return { ...run, steps };
}

export async function mutateChannelTeamRun(input: {
  organizationId: string;
  userId: string;
  runId: string;
  operation: "cancel" | "retry";
}) {
  await assertUserPermission({ ...input, permission: "agents:manage" });
  return input.operation === "cancel"
    ? cancelAgentTeamRun(input.organizationId, input.runId)
    : retryAgentTeamRun(input.organizationId, input.runId);
}

export async function listChannelApprovals(input: { organizationId: string; userId: string }) {
  await assertUserPermission({ ...input, permission: "runs:read" });
  return listPendingToolApprovals(input.organizationId);
}

export async function getChannelApproval(input: {
  organizationId: string;
  userId: string;
  approvalId: string;
}) {
  await assertUserPermission({ ...input, permission: "runs:read" });
  return getToolApproval(input.organizationId, input.approvalId);
}

export async function decideChannelApproval(input: {
  organizationId: string;
  userId: string;
  approvalId: string;
  approved: boolean;
  source: "telegram" | "whatsapp";
}) {
  await assertUserPermission({ ...input, permission: "agents:run" });
  const result = await decideToolApproval({
    organizationId: input.organizationId,
    approvalId: input.approvalId,
    userId: input.userId,
    approved: input.approved,
    reason: `${input.approved ? "Approved" : "Rejected"} from ${input.source}`,
  });
  const queued = result.sandboxExecutionId
    ? await enqueueSandboxResume({
        organizationId: input.organizationId,
        approvalId: input.approvalId,
        executionId: result.sandboxExecutionId,
      })
    : result.browserTaskId
      ? await enqueueBrowserResume({
          organizationId: input.organizationId,
          approvalId: input.approvalId,
          browserTaskId: result.browserTaskId,
        })
      : await enqueueAgentRunResume({
          organizationId: input.organizationId,
          approvalId: input.approvalId,
        });
  return { approval: result, queued };
}

export async function channelBrowserDiagnostics(input: { organizationId: string; userId: string }) {
  const role = await assertUserPermission({ ...input, permission: "browser_tasks:read" });
  const [health, tasks] = await Promise.all([
    testCurrentAuthenticatedRunner("browser"),
    listBrowserTasks({
      organizationId: input.organizationId,
      userId: input.userId,
      role,
      limit: 12,
    }),
  ]);
  return { health, tasks };
}

export async function channelSandboxDiagnostics(input: { organizationId: string; userId: string }) {
  await assertUserPermission({ ...input, permission: "sandbox:read" });
  const role = await userOrganizationRole(input.userId, input.organizationId);
  const actor = { organizationId: input.organizationId, userId: input.userId, role };
  const [health, workspaces, executions] = await Promise.all([
    testCurrentAuthenticatedRunner("sandbox"),
    listSandboxWorkspaces({ actor }),
    listSandboxExecutions({ actor, limit: 12 }),
  ]);
  return { health, workspaces, executions };
}
