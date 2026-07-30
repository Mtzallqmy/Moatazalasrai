import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  agentTeamRunsRuntime,
  agentTeamRunStepsRuntime,
} from "@/db/agent-runtime-schema";
import {
  agentTeamMembers,
  agentTeams,
  agents,
  conversations,
  messages,
  runs,
} from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { enqueueAgentTeamRun } from "@/worker/queue";
import { executeAgentRun } from "./runtime";
import { withTelemetry } from "@/ai/observability/telemetry";

type TeamAgent = { id: string; name: string };
type TeamStepType = "worker" | "supervisor";

type PersistedTeam = {
  team: typeof agentTeams.$inferSelect;
  supervisor: TeamAgent;
  workers: Array<{ agent: TeamAgent; position: number }>;
};

function stableStepRequestId(teamRunId: string, stepType: TeamStepType, position: number) {
  return `team:${teamRunId}:${stepType}:${position}`;
}

function safeTeamErrorCode(error: unknown) {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message)) return error.message;
  return "TEAM_RUN_FAILED";
}

async function loadTeam(organizationId: string, teamId: string): Promise<PersistedTeam> {
  const [team] = await db().select().from(agentTeams).where(and(
    eq(agentTeams.id, teamId),
    eq(agentTeams.organizationId, organizationId),
    eq(agentTeams.enabled, true),
  )).limit(1);
  if (!team) throw new ApiError(404, "AGENT_TEAM_NOT_FOUND", "فريق الوكلاء غير موجود أو معطل.");

  const memberRows = await db().select({
    agentId: agentTeamMembers.agentId,
    position: agentTeamMembers.position,
  }).from(agentTeamMembers).where(and(
    eq(agentTeamMembers.teamId, team.id),
    eq(agentTeamMembers.organizationId, organizationId),
  )).orderBy(asc(agentTeamMembers.position));

  const allAgentIds = [...new Set([team.supervisorAgentId, ...memberRows.map((member) => member.agentId)])];
  const publishedAgents = await db().select({ id: agents.id, name: agents.name }).from(agents).where(and(
    eq(agents.organizationId, organizationId),
    eq(agents.status, "published"),
    inArray(agents.id, allAgentIds),
  ));
  const byId = new Map(publishedAgents.map((agent) => [agent.id, agent]));
  const supervisor = byId.get(team.supervisorAgentId);
  if (!supervisor) throw new ApiError(422, "TEAM_SUPERVISOR_UNAVAILABLE", "وكيل الإشراف غير منشور.");

  const workers = memberRows
    .filter((member) => member.agentId !== team.supervisorAgentId && byId.has(member.agentId))
    .map((member, position) => ({ agent: byId.get(member.agentId)!, position }));
  if (workers.length === 0) throw new ApiError(422, "TEAM_WORKERS_REQUIRED", "أضف وكيلاً عاملاً واحداً على الأقل إلى الفريق.");

  return { team, supervisor, workers };
}

async function cancellationRequested(organizationId: string, teamRunId: string) {
  const [row] = await db().select({
    status: agentTeamRunsRuntime.status,
    cancelRequestedAt: agentTeamRunsRuntime.cancelRequestedAt,
  }).from(agentTeamRunsRuntime).where(and(
    eq(agentTeamRunsRuntime.id, teamRunId),
    eq(agentTeamRunsRuntime.organizationId, organizationId),
  )).limit(1);
  return !row || row.status === "cancelled" || Boolean(row.cancelRequestedAt);
}

async function assertNotCancelled(organizationId: string, teamRunId: string) {
  if (await cancellationRequested(organizationId, teamRunId)) {
    throw new ApiError(409, "TEAM_RUN_CANCELLED", "تم إلغاء تشغيل الفريق.");
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function findOrCreateStep(input: {
  organizationId: string;
  teamRunId: string;
  agentId: string;
  stepType: TeamStepType;
  position: number;
}) {
  const stableRequestId = stableStepRequestId(input.teamRunId, input.stepType, input.position);
  await db().insert(agentTeamRunStepsRuntime).values({
    organizationId: input.organizationId,
    teamRunId: input.teamRunId,
    agentId: input.agentId,
    stepType: input.stepType,
    position: input.position,
    stableRequestId,
    status: "queued",
  }).onConflictDoNothing();

  const [step] = await db().select().from(agentTeamRunStepsRuntime).where(and(
    eq(agentTeamRunStepsRuntime.organizationId, input.organizationId),
    eq(agentTeamRunStepsRuntime.teamRunId, input.teamRunId),
    eq(agentTeamRunStepsRuntime.stepType, input.stepType),
    eq(agentTeamRunStepsRuntime.position, input.position),
  )).limit(1);
  if (!step) throw new Error("TEAM_STEP_CREATE_FAILED");
  return step;
}

async function ensureStepConversation(input: {
  organizationId: string;
  teamRunId: string;
  stepId: string;
  agent: TeamAgent;
  stepType: TeamStepType;
  prompt: string;
  userId?: string | null;
  stableRequestId: string;
  currentConversationId?: string | null;
}) {
  let conversationId = input.currentConversationId ?? null;
  if (!conversationId) {
    const [conversation] = await db().insert(conversations).values({
      organizationId: input.organizationId,
      agentId: input.agent.id,
      title: `تشغيل فريق — ${input.agent.name}`,
      createdByUserId: input.userId,
    }).returning({ id: conversations.id });
    if (!conversation) throw new Error("TEAM_CONVERSATION_CREATE_FAILED");
    conversationId = conversation.id;
    await db().update(agentTeamRunStepsRuntime).set({ conversationId }).where(and(
      eq(agentTeamRunStepsRuntime.id, input.stepId),
      eq(agentTeamRunStepsRuntime.organizationId, input.organizationId),
    ));
  }

  await db().insert(messages).values({
    conversationId,
    role: "user",
    content: input.prompt,
    clientRequestId: input.stableRequestId,
    metadata: { teamRunId: input.teamRunId, stepType: input.stepType },
  }).onConflictDoNothing();
  return conversationId;
}

async function reusableRun(organizationId: string, requestId: string) {
  const [run] = await db().select({
    id: runs.id,
    status: runs.status,
    output: runs.output,
  }).from(runs).where(and(
    eq(runs.organizationId, organizationId),
    eq(runs.requestId, requestId),
  )).limit(1);
  return run;
}

async function runMember(input: {
  organizationId: string;
  teamRunId: string;
  teamAttempt: number;
  agent: TeamAgent;
  prompt: string;
  position: number;
  userId?: string | null;
  stepType: TeamStepType;
}) {
  await assertNotCancelled(input.organizationId, input.teamRunId);
  const step = await findOrCreateStep({
    organizationId: input.organizationId,
    teamRunId: input.teamRunId,
    agentId: input.agent.id,
    stepType: input.stepType,
    position: input.position,
  });
  if (step.status === "completed" && step.output) {
    return { agentId: input.agent.id, agentName: input.agent.name, output: step.output, runId: step.runId };
  }

  const stableRequestId = step.stableRequestId ?? stableStepRequestId(input.teamRunId, input.stepType, input.position);
  const conversationId = await ensureStepConversation({
    organizationId: input.organizationId,
    teamRunId: input.teamRunId,
    stepId: step.id,
    agent: input.agent,
    stepType: input.stepType,
    prompt: input.prompt,
    userId: input.userId,
    stableRequestId,
    currentConversationId: step.conversationId,
  });

  if (step.runId) {
    const [existingById] = await db().select({ id: runs.id, status: runs.status, output: runs.output }).from(runs).where(and(
      eq(runs.id, step.runId),
      eq(runs.organizationId, input.organizationId),
    )).limit(1);
    if (existingById?.status === "completed" && existingById.output) {
      await db().update(agentTeamRunStepsRuntime).set({
        status: "completed",
        output: existingById.output,
        errorCode: null,
        completedAt: new Date(),
      }).where(and(eq(agentTeamRunStepsRuntime.id, step.id), eq(agentTeamRunStepsRuntime.organizationId, input.organizationId)));
      return { agentId: input.agent.id, agentName: input.agent.name, output: existingById.output, runId: existingById.id };
    }
  }

  const firstRequestId = stableRequestId;
  const existing = await reusableRun(input.organizationId, firstRequestId);
  if (existing?.status === "completed" && existing.output) {
    await db().update(agentTeamRunStepsRuntime).set({
      runId: existing.id,
      status: "completed",
      output: existing.output,
      errorCode: null,
      completedAt: new Date(),
    }).where(and(eq(agentTeamRunStepsRuntime.id, step.id), eq(agentTeamRunStepsRuntime.organizationId, input.organizationId)));
    return { agentId: input.agent.id, agentName: input.agent.name, output: existing.output, runId: existing.id };
  }

  const requestId = existing ? `${stableRequestId}:retry:${input.teamAttempt}` : firstRequestId;
  const startedAt = new Date();
  await db().update(agentTeamRunStepsRuntime).set({
    status: "running",
    errorCode: null,
    startedAt,
    completedAt: null,
  }).where(and(eq(agentTeamRunStepsRuntime.id, step.id), eq(agentTeamRunStepsRuntime.organizationId, input.organizationId)));

  try {
    const result = await executeAgentRun({
      organizationId: input.organizationId,
      userId: input.userId ?? undefined,
      agentId: input.agent.id,
      conversationId,
      message: input.prompt,
      requestId,
    });
    await assertNotCancelled(input.organizationId, input.teamRunId);
    const output = result.assistantMessage?.content ?? result.run?.output ?? "";
    if (!output.trim()) throw new ApiError(502, "TEAM_STEP_EMPTY_OUTPUT", "لم يُرجع وكيل الفريق نتيجة.");
    const completedAt = new Date();
    await db().update(agentTeamRunStepsRuntime).set({
      runId: result.run?.id,
      status: "completed",
      output,
      errorCode: null,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      completedAt,
    }).where(and(eq(agentTeamRunStepsRuntime.id, step.id), eq(agentTeamRunStepsRuntime.organizationId, input.organizationId)));
    return { agentId: input.agent.id, agentName: input.agent.name, output, runId: result.run?.id };
  } catch (error) {
    const completedAt = new Date();
    await db().update(agentTeamRunStepsRuntime).set({
      status: "failed",
      errorCode: safeTeamErrorCode(error),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      completedAt,
    }).where(and(eq(agentTeamRunStepsRuntime.id, step.id), eq(agentTeamRunStepsRuntime.organizationId, input.organizationId)));
    throw error;
  }
}

export async function createAgentTeamRun(input: {
  organizationId: string;
  teamId: string;
  prompt: string;
  requestId: string;
  userId?: string | null;
}) {
  const [existing] = await db().select().from(agentTeamRunsRuntime).where(and(
    eq(agentTeamRunsRuntime.organizationId, input.organizationId),
    eq(agentTeamRunsRuntime.requestId, input.requestId),
  )).limit(1);
  if (existing) {
    if (existing.teamId !== input.teamId || existing.input !== input.prompt) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "استُخدم Idempotency-Key نفسه لتشغيل فريق أو مدخل مختلف.");
    }
    if (!existing.graphileJobId && existing.status === "queued") {
      const queued = await enqueueAgentTeamRun({ organizationId: input.organizationId, teamRunId: existing.id });
      const [updated] = await db().update(agentTeamRunsRuntime).set({
        graphileJobId: queued.jobId,
        updatedAt: new Date(),
      }).where(and(eq(agentTeamRunsRuntime.id, existing.id), eq(agentTeamRunsRuntime.organizationId, input.organizationId))).returning();
      return updated ?? existing;
    }
    return existing;
  }

  await loadTeam(input.organizationId, input.teamId);
  const [created] = await db().insert(agentTeamRunsRuntime).values({
    organizationId: input.organizationId,
    teamId: input.teamId,
    requestedByUserId: input.userId,
    requestId: input.requestId,
    input: input.prompt,
    status: "queued",
  }).returning();
  if (!created) throw new Error("TEAM_RUN_CREATE_FAILED");

  try {
    const queued = await enqueueAgentTeamRun({ organizationId: input.organizationId, teamRunId: created.id });
    const [updated] = await db().update(agentTeamRunsRuntime).set({
      graphileJobId: queued.jobId,
      updatedAt: new Date(),
    }).where(and(eq(agentTeamRunsRuntime.id, created.id), eq(agentTeamRunsRuntime.organizationId, input.organizationId))).returning();
    return updated ?? created;
  } catch (error) {
    await db().update(agentTeamRunsRuntime).set({
      status: "failed",
      errorCode: "TEAM_QUEUE_FAILED",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(agentTeamRunsRuntime.id, created.id), eq(agentTeamRunsRuntime.organizationId, input.organizationId)));
    throw new ApiError(503, "TEAM_QUEUE_FAILED", "تعذر إضافة تشغيل الفريق إلى قائمة العمل.", {
      cause: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}

export async function executePersistedAgentTeamRun(input: {
  organizationId: string;
  teamRunId: string;
}) {
  return withTelemetry({
    operation: "agent.team.run",
    organizationId: input.organizationId,
    teamRunId: input.teamRunId,
  }, async () => {
    const [current] = await db().select().from(agentTeamRunsRuntime).where(and(
      eq(agentTeamRunsRuntime.id, input.teamRunId),
      eq(agentTeamRunsRuntime.organizationId, input.organizationId),
    )).limit(1);
    if (!current) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");
    if (current.status === "completed" || current.status === "cancelled") return current;
    if (current.cancelRequestedAt) {
      const [cancelled] = await db().update(agentTeamRunsRuntime).set({
        status: "cancelled",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(agentTeamRunsRuntime.id, current.id), eq(agentTeamRunsRuntime.organizationId, input.organizationId))).returning();
      return cancelled ?? current;
    }

    const startedAt = current.startedAt ?? new Date();
    const [running] = await db().update(agentTeamRunsRuntime).set({
      status: "running",
      startedAt,
      completedAt: null,
      errorCode: null,
      attempts: current.attempts + 1,
      updatedAt: new Date(),
    }).where(and(eq(agentTeamRunsRuntime.id, current.id), eq(agentTeamRunsRuntime.organizationId, input.organizationId))).returning();
    if (!running) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");

    try {
      const persisted = await loadTeam(input.organizationId, running.teamId);
      const selectedWorkers = persisted.workers;
      const workerResults = await mapWithConcurrency(
        selectedWorkers,
        persisted.team.maxParallelWorkers,
        ({ agent, position }) => runMember({
          organizationId: input.organizationId,
          teamRunId: running.id,
          teamAttempt: running.attempts,
          agent,
          prompt: `أنت عضو متخصص ضمن فريق وكلاء. حلّل المهمة التالية من منظور تخصصك وقدّم نتيجة دقيقة قابلة للدمج:\n\n${running.input}`,
          position,
          userId: running.requestedByUserId,
          stepType: "worker",
        }),
      );

      await assertNotCancelled(input.organizationId, running.id);
      const evidence = workerResults.map((result, index) =>
        `نتيجة العضو ${index + 1} — ${result.agentName}:\n${result.output}`).join("\n\n---\n\n");
      const supervisorPrompt = [
        "أنت المشرف على فريق وكلاء. ادمج نتائج الأعضاء في إجابة نهائية واحدة.",
        "أزل التكرار، عالج التعارضات، ولا تدّع نتيجة غير موجودة في مخرجات الفريق.",
        `المهمة الأصلية:\n${running.input}`,
        `نتائج الفريق:\n${evidence}`,
      ].join("\n\n");
      const finalResult = await runMember({
        organizationId: input.organizationId,
        teamRunId: running.id,
        teamAttempt: running.attempts,
        agent: persisted.supervisor,
        prompt: supervisorPrompt,
        position: selectedWorkers.length,
        userId: running.requestedByUserId,
        stepType: "supervisor",
      });
      await assertNotCancelled(input.organizationId, running.id);

      const [completed] = await db().update(agentTeamRunsRuntime).set({
        status: "completed",
        output: finalResult.output,
        errorCode: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(agentTeamRunsRuntime.id, running.id), eq(agentTeamRunsRuntime.organizationId, input.organizationId))).returning();
      return completed ?? running;
    } catch (error) {
      const cancelled = safeTeamErrorCode(error) === "TEAM_RUN_CANCELLED";
      await db().update(agentTeamRunsRuntime).set({
        status: cancelled ? "cancelled" : "failed",
        errorCode: cancelled ? null : safeTeamErrorCode(error),
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(agentTeamRunsRuntime.id, running.id), eq(agentTeamRunsRuntime.organizationId, input.organizationId)));
      if (cancelled) {
        const [row] = await db().select().from(agentTeamRunsRuntime).where(and(
          eq(agentTeamRunsRuntime.id, running.id),
          eq(agentTeamRunsRuntime.organizationId, input.organizationId),
        )).limit(1);
        return row ?? running;
      }
      throw error;
    }
  });
}

export async function cancelAgentTeamRun(organizationId: string, teamRunId: string) {
  const [current] = await db().select().from(agentTeamRunsRuntime).where(and(
    eq(agentTeamRunsRuntime.id, teamRunId),
    eq(agentTeamRunsRuntime.organizationId, organizationId),
  )).limit(1);
  if (!current) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");
  if (["completed", "failed", "cancelled"].includes(current.status)) return current;
  const now = new Date();
  const [updated] = await db().update(agentTeamRunsRuntime).set({
    cancelRequestedAt: now,
    ...(current.status === "queued" ? { status: "cancelled", completedAt: now } : {}),
    updatedAt: now,
  }).where(and(eq(agentTeamRunsRuntime.id, teamRunId), eq(agentTeamRunsRuntime.organizationId, organizationId))).returning();
  return updated ?? current;
}

export async function retryAgentTeamRun(organizationId: string, teamRunId: string) {
  const [current] = await db().select().from(agentTeamRunsRuntime).where(and(
    eq(agentTeamRunsRuntime.id, teamRunId),
    eq(agentTeamRunsRuntime.organizationId, organizationId),
  )).limit(1);
  if (!current) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");
  if (current.status !== "failed") throw new ApiError(409, "TEAM_RUN_RETRY_UNAVAILABLE", "يمكن إعادة محاولة تشغيل فريق فاشل فقط.");
  const queued = await enqueueAgentTeamRun({ organizationId, teamRunId });
  const [updated] = await db().update(agentTeamRunsRuntime).set({
    status: "queued",
    errorCode: null,
    completedAt: null,
    cancelRequestedAt: null,
    retryRequestedAt: new Date(),
    graphileJobId: queued.jobId,
    updatedAt: new Date(),
  }).where(and(eq(agentTeamRunsRuntime.id, teamRunId), eq(agentTeamRunsRuntime.organizationId, organizationId))).returning();
  return updated ?? current;
}
