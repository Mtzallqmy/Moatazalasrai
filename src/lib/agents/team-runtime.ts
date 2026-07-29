import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  agentTeamMembers,
  agentTeamRuns,
  agentTeamRunSteps,
  agentTeams,
  agents,
  conversations,
  messages,
} from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { executeAgentRun } from "./runtime";

async function runMember(input: {
  organizationId: string;
  teamRunId: string;
  agentId: string;
  agentName: string;
  prompt: string;
  position: number;
  userId?: string | null;
  stepType: "worker" | "supervisor";
}) {
  const [step] = await db().insert(agentTeamRunSteps).values({
    organizationId: input.organizationId,
    teamRunId: input.teamRunId,
    agentId: input.agentId,
    stepType: input.stepType,
    position: input.position,
    status: "running",
  }).returning({ id: agentTeamRunSteps.id });
  if (!step) throw new Error("TEAM_STEP_CREATE_FAILED");
  const [conversation] = await db().insert(conversations).values({
    organizationId: input.organizationId,
    agentId: input.agentId,
    title: `تشغيل فريق — ${input.agentName}`,
    createdByUserId: input.userId,
  }).returning({ id: conversations.id });
  if (!conversation) throw new Error("TEAM_CONVERSATION_CREATE_FAILED");
  await db().insert(messages).values({
    conversationId: conversation.id,
    role: "user",
    content: input.prompt,
    metadata: { teamRunId: input.teamRunId, stepType: input.stepType },
  });
  try {
    const result = await executeAgentRun({
      organizationId: input.organizationId,
      agentId: input.agentId,
      conversationId: conversation.id,
      message: input.prompt,
      requestId: `${input.teamRunId}:${input.stepType}:${input.position}`,
    });
    await db().update(agentTeamRunSteps).set({
      runId: result.run?.id,
      status: "completed",
      output: result.assistantMessage?.content ?? result.run?.output ?? "",
      completedAt: new Date(),
    }).where(eq(agentTeamRunSteps.id, step.id));
    return {
      agentId: input.agentId,
      agentName: input.agentName,
      output: result.assistantMessage?.content ?? result.run?.output ?? "",
      runId: result.run?.id,
    };
  } catch (error) {
    await db().update(agentTeamRunSteps).set({
      status: "failed",
      errorCode: error instanceof ApiError ? error.code : "AGENT_STEP_FAILED",
      completedAt: new Date(),
    }).where(eq(agentTeamRunSteps.id, step.id));
    throw error;
  }
}

export async function executeAgentTeam(input: {
  organizationId: string;
  teamId: string;
  prompt: string;
  requestId: string;
  userId?: string | null;
}) {
  const [existing] = await db().select().from(agentTeamRuns).where(and(
    eq(agentTeamRuns.organizationId, input.organizationId),
    eq(agentTeamRuns.requestId, input.requestId),
  )).limit(1);
  if (existing) return existing;

  const [team] = await db().select().from(agentTeams).where(and(
    eq(agentTeams.id, input.teamId),
    eq(agentTeams.organizationId, input.organizationId),
    eq(agentTeams.enabled, true),
  )).limit(1);
  if (!team) throw new ApiError(404, "AGENT_TEAM_NOT_FOUND", "فريق الوكلاء غير موجود أو معطل.");
  const memberRows = await db().select({
    agentId: agentTeamMembers.agentId,
    role: agentTeamMembers.role,
    position: agentTeamMembers.position,
  }).from(agentTeamMembers).where(and(
    eq(agentTeamMembers.teamId, team.id),
    eq(agentTeamMembers.organizationId, input.organizationId),
  )).orderBy(asc(agentTeamMembers.position));
  const allAgentIds = [...new Set([team.supervisorAgentId, ...memberRows.map((member) => member.agentId)])];
  const publishedAgents = await db().select({
    id: agents.id,
    name: agents.name,
  }).from(agents).where(and(
    eq(agents.organizationId, input.organizationId),
    eq(agents.status, "published"),
    inArray(agents.id, allAgentIds),
  ));
  const byId = new Map(publishedAgents.map((agent) => [agent.id, agent]));
  const supervisor = byId.get(team.supervisorAgentId);
  if (!supervisor) throw new ApiError(422, "TEAM_SUPERVISOR_UNAVAILABLE", "وكيل الإشراف غير منشور.");
  const workers = memberRows
    .filter((member) => member.agentId !== team.supervisorAgentId && byId.has(member.agentId))
    .slice(0, team.maxParallelWorkers);
  if (workers.length === 0) throw new ApiError(422, "TEAM_WORKERS_REQUIRED", "أضف وكيلاً عاملاً واحداً على الأقل إلى الفريق.");

  const [teamRun] = await db().insert(agentTeamRuns).values({
    organizationId: input.organizationId,
    teamId: team.id,
    requestedByUserId: input.userId,
    requestId: input.requestId,
    input: input.prompt,
    status: "running",
    startedAt: new Date(),
  }).returning();
  if (!teamRun) throw new Error("TEAM_RUN_CREATE_FAILED");

  try {
    const workerResults = await Promise.all(workers.map((member, index) => {
      const agent = byId.get(member.agentId)!;
      return runMember({
        organizationId: input.organizationId,
        teamRunId: teamRun.id,
        agentId: agent.id,
        agentName: agent.name,
        prompt: `أنت عضو متخصص ضمن فريق وكلاء. حلّل المهمة التالية من منظور تخصصك وقدّم نتيجة دقيقة قابلة للدمج:\n\n${input.prompt}`,
        position: index,
        userId: input.userId,
        stepType: "worker",
      });
    }));
    const evidence = workerResults.map((result, index) =>
      `نتيجة العضو ${index + 1} — ${result.agentName}:\n${result.output}`).join("\n\n---\n\n");
    const supervisorPrompt = [
      "أنت المشرف على فريق وكلاء. ادمج نتائج الأعضاء في إجابة نهائية واحدة.",
      "أزل التكرار، عالج التعارضات، ولا تدّع نتيجة غير موجودة في مخرجات الفريق.",
      `المهمة الأصلية:\n${input.prompt}`,
      `نتائج الفريق:\n${evidence}`,
    ].join("\n\n");
    const finalResult = await runMember({
      organizationId: input.organizationId,
      teamRunId: teamRun.id,
      agentId: supervisor.id,
      agentName: supervisor.name,
      prompt: supervisorPrompt,
      position: workers.length,
      userId: input.userId,
      stepType: "supervisor",
    });
    const [completed] = await db().update(agentTeamRuns).set({
      status: "completed",
      output: finalResult.output,
      completedAt: new Date(),
    }).where(eq(agentTeamRuns.id, teamRun.id)).returning();
    return completed;
  } catch (error) {
    await db().update(agentTeamRuns).set({
      status: "failed",
      errorCode: error instanceof ApiError ? error.code : "TEAM_RUN_FAILED",
      completedAt: new Date(),
    }).where(eq(agentTeamRuns.id, teamRun.id));
    throw error;
  }
}
