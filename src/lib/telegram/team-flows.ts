import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentTeamRunsRuntime, agentTeamRunStepsRuntime } from "@/db/agent-runtime-schema";
import { agentTeamMembers, agentTeams, agents } from "@/db/schema";
import {
  cancelAgentTeamRun,
  createAgentTeamRun,
  retryAgentTeamRun,
} from "@/lib/agents/team-runtime";
import { assertActorPermission, actorCan } from "@/lib/auth/actor-authorization";
import { ApiError } from "@/lib/http/api";
import {
  advanceTelegramFlow,
  beginTelegramFlow,
  completeTelegramFlow,
  updateTelegramSession,
} from "@/lib/telegram/session-service";
import {
  sendTelegramEmptyState,
  sendTelegramList,
  sendTelegramMenu,
} from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";

function callbackMessageId(context: TelegramActionContext) {
  return context.update.kind === "callback_query" ? context.update.messageId : undefined;
}

export async function renderTeams(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "agents:read");
  const page = Math.max(1, context.page);
  const limit = 5;
  const where = and(eq(agentTeams.organizationId, context.actor.organizationId), eq(agentTeams.enabled, true));
  const [teams, totalRows] = await Promise.all([
    db().select().from(agentTeams).where(where).orderBy(desc(agentTeams.updatedAt)).limit(limit).offset((page - 1) * limit),
    db().select({ value: count() }).from(agentTeams).where(where),
  ]);
  const members = teams.length
    ? await db().select({
        teamId: agentTeamMembers.teamId,
        role: agentTeamMembers.role,
        position: agentTeamMembers.position,
        agentName: agents.name,
      }).from(agentTeamMembers)
        .innerJoin(agents, eq(agents.id, agentTeamMembers.agentId))
        .where(and(
          eq(agentTeamMembers.organizationId, context.actor.organizationId),
          inArray(agentTeamMembers.teamId, teams.map((team) => team.id)),
        )).orderBy(asc(agentTeamMembers.position))
    : [];
  const total = Number(totalRows[0]?.value ?? 0);
  const pages = Math.ceil(total / limit);
  const pager = [] as Array<{ id: string; title: string }>;
  if (page > 1) pager.push({ id: `cap:teams.list:${page - 1}`, title: "السابق" });
  if (page < pages) pager.push({ id: `cap:teams.list:${page + 1}`, title: "التالي" });
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← العمل الذكي ← فرق الوكلاء",
    title: `فرق الوكلاء الفعلية — صفحة ${page} من ${Math.max(1, pages)}`,
    items: teams.map((team, index) => {
      const teamMembers = members.filter((member) => member.teamId === team.id);
      return `${(page - 1) * limit + index + 1}. ${team.name}\nالأعضاء: ${teamMembers.map((member) => `${member.agentName} (${member.role})`).join("، ") || "لا يوجد"}\nالتوازي الأقصى: ${team.maxParallelWorkers}\nآخر تحديث: ${team.updatedAt.toISOString()}`;
    }),
    emptyText: "لا توجد فرق وكلاء مفعلة في المؤسسة.",
    buttonRows: [
      ...teams.map((team) => [{ id: `team:v:${team.id}`, title: team.name.slice(0, 55) }]),
      ...(pager.length ? [pager] : []),
      [{ id: "nav:home", title: "الرئيسية" }, { id: `cap:teams.list:${page}`, title: "تحديث" }],
    ],
  });
}

export async function renderTeamDetails(context: TelegramActionContext, teamId: string) {
  await assertActorPermission(context.actor, "agents:read");
  const [team] = await db().select().from(agentTeams).where(and(
    eq(agentTeams.id, teamId),
    eq(agentTeams.organizationId, context.actor.organizationId),
    eq(agentTeams.enabled, true),
  )).limit(1);
  if (!team) throw new ApiError(404, "TEAM_NOT_FOUND", "فريق الوكلاء غير موجود.");
  const members = await db().select({
    role: agentTeamMembers.role,
    position: agentTeamMembers.position,
    agentName: agents.name,
    agentStatus: agents.status,
  }).from(agentTeamMembers)
    .innerJoin(agents, eq(agents.id, agentTeamMembers.agentId))
    .where(and(
      eq(agentTeamMembers.organizationId, context.actor.organizationId),
      eq(agentTeamMembers.teamId, team.id),
    )).orderBy(asc(agentTeamMembers.position));
  const canRun = await actorCan(context.actor, "agents:run");
  const runnable = members.length > 0 && members.every((member) => member.agentStatus === "published");
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← العمل الذكي ← فرق الوكلاء ← تفاصيل الفريق",
    title: team.name,
    description: [
      team.description || "بدون وصف",
      `الأعضاء: ${members.length}`,
      ...members.map((member, index) => `${index + 1}. ${member.agentName} — ${member.role} — ${member.agentStatus}`),
      `الجاهزية: ${runnable ? "جاهز" : "يوجد عضو غير منشور"}`,
    ].join("\n"),
    buttonRows: [
      ...(canRun && runnable ? [[{ id: `team:r:${team.id}`, title: "تشغيل الفريق" }]] : []),
      [{ id: "cap:teams.list:1", title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function startTeamRun(context: TelegramActionContext, teamId: string) {
  await assertActorPermission(context.actor, "agents:run");
  const [team] = await db().select({ id: agentTeams.id, name: agentTeams.name }).from(agentTeams).where(and(
    eq(agentTeams.id, teamId),
    eq(agentTeams.organizationId, context.actor.organizationId),
    eq(agentTeams.enabled, true),
  )).limit(1);
  if (!team) throw new ApiError(404, "TEAM_NOT_FOUND", "فريق الوكلاء غير موجود.");
  context.session = await beginTelegramFlow(
    await updateTelegramSession(context.session, { selectedTeamId: team.id }),
    { flow: "team.run", step: "input", state: { teamName: team.name } },
  );
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← فرق الوكلاء ← تشغيل الفريق",
    title: `تشغيل ${team.name}`,
    description: "أرسل المهمة التي تريد من الفريق تنفيذها. لن يبدأ التشغيل قبل استقبال النص وحفظه.",
    buttonRows: [[{ id: "flow:cancel", title: "إلغاء" }]],
  });
}

export async function handleTeamRunText(context: TelegramActionContext, input: string) {
  if (context.session.activeFlow !== "team.run") return false;
  if (context.session.currentStep !== "input" || !context.session.selectedTeamId) {
    throw new ApiError(409, "TELEGRAM_FLOW_STEP_INVALID", "حالة تشغيل الفريق غير مكتملة.");
  }
  const prompt = input.trim();
  if (!prompt || prompt.length > 20_000) throw new ApiError(400, "TEAM_INPUT_INVALID", "مهمة الفريق مطلوبة ويجب ألا تتجاوز 20000 حرف.");
  context.session = await advanceTelegramFlow(context.session, {
    step: "confirm",
    state: { ...context.session.state, prompt },
  });
  return sendTelegramMenu({
    chatId: context.update.chatId,
    path: "الرئيسية ← فرق الوكلاء ← تشغيل الفريق",
    title: "تأكيد تشغيل الفريق",
    description: `الفريق: ${String(context.session.state.teamName ?? "الفريق المختار")}\n\nالمهمة:\n${prompt}`,
    buttonRows: [[{ id: "team:run:confirm", title: "تأكيد التشغيل" }], [{ id: "flow:cancel", title: "إلغاء" }]],
  }).then(() => true);
}

export async function confirmTeamRun(context: TelegramActionContext) {
  if (context.session.activeFlow !== "team.run" || context.session.currentStep !== "confirm" || !context.session.selectedTeamId) {
    throw new ApiError(409, "CONFIRMATION_REQUIRED", "لا يوجد تشغيل فريق صالح بانتظار التأكيد.");
  }
  const prompt = typeof context.session.state.prompt === "string" ? context.session.state.prompt.trim() : "";
  if (!prompt) throw new ApiError(409, "TEAM_INPUT_INVALID", "مهمة الفريق مفقودة.");
  const run = await createAgentTeamRun({
    organizationId: context.actor.organizationId,
    teamId: context.session.selectedTeamId,
    prompt,
    requestId: `telegram:${context.session.id}:${context.update.updateId}`,
    userId: context.actor.userId,
  });
  context.session = await completeTelegramFlow(context.session);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← فرق الوكلاء ← نتيجة التشغيل",
    title: "تم إنشاء تشغيل الفريق فعليًا",
    description: `Run ID: ${run.id}\nالحالة: ${run.status}\nتم إرسال المهمة إلى Graphile Worker ويمكن متابعة حالتها من العمليات.",
    buttonRows: [[{ id: `run:t:${run.id}`, title: "متابعة التشغيل" }], [{ id: "cap:runs.list:1", title: "كل العمليات" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function renderRuns(context: TelegramActionContext) {
  await assertActorPermission(context.actor, "runs:read");
  const page = Math.max(1, context.page);
  const limit = 6;
  const where = eq(agentTeamRunsRuntime.organizationId, context.actor.organizationId);
  const [rows, totals] = await Promise.all([
    db().select({
      id: agentTeamRunsRuntime.id,
      teamId: agentTeamRunsRuntime.teamId,
      teamName: agentTeams.name,
      input: agentTeamRunsRuntime.input,
      output: agentTeamRunsRuntime.output,
      status: agentTeamRunsRuntime.status,
      errorCode: agentTeamRunsRuntime.errorCode,
      attempts: agentTeamRunsRuntime.attempts,
      createdAt: agentTeamRunsRuntime.createdAt,
      updatedAt: agentTeamRunsRuntime.updatedAt,
    }).from(agentTeamRunsRuntime)
      .leftJoin(agentTeams, eq(agentTeams.id, agentTeamRunsRuntime.teamId))
      .where(where).orderBy(desc(agentTeamRunsRuntime.createdAt)).limit(limit).offset((page - 1) * limit),
    db().select({ value: count() }).from(agentTeamRunsRuntime).where(where),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  const pages = Math.ceil(total / limit);
  const pager = [] as Array<{ id: string; title: string }>;
  if (page > 1) pager.push({ id: `cap:runs.list:${page - 1}`, title: "السابق" });
  if (page < pages) pager.push({ id: `cap:runs.list:${page + 1}`, title: "التالي" });
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← العمل الذكي ← عمليات التشغيل",
    title: `عمليات فرق الوكلاء — صفحة ${page} من ${Math.max(1, pages)}`,
    items: rows.map((run, index) => `${(page - 1) * limit + index + 1}. ${run.teamName ?? "فريق محذوف"}\nRun ID: ${run.id}\nالحالة: ${run.status}\nالمحاولات: ${run.attempts}\nالخطأ: ${run.errorCode ?? "لا يوجد"}\nبدأ: ${run.createdAt.toISOString()}`),
    emptyText: "لا توجد عمليات تشغيل فرق في المؤسسة.",
    buttonRows: [
      ...rows.map((run) => [{ id: `run:t:${run.id}`, title: `${run.teamName ?? "تشغيل"} — ${run.status}`.slice(0, 60) }]),
      ...(pager.length ? [pager] : []),
      [{ id: "nav:home", title: "الرئيسية" }, { id: `cap:runs.list:${page}`, title: "تحديث" }],
    ],
  });
}

export async function renderRunDetails(context: TelegramActionContext, runId: string) {
  await assertActorPermission(context.actor, "runs:read");
  const [run] = await db().select({
    id: agentTeamRunsRuntime.id,
    teamName: agentTeams.name,
    input: agentTeamRunsRuntime.input,
    output: agentTeamRunsRuntime.output,
    status: agentTeamRunsRuntime.status,
    errorCode: agentTeamRunsRuntime.errorCode,
    attempts: agentTeamRunsRuntime.attempts,
    createdAt: agentTeamRunsRuntime.createdAt,
    startedAt: agentTeamRunsRuntime.startedAt,
    completedAt: agentTeamRunsRuntime.completedAt,
  }).from(agentTeamRunsRuntime)
    .leftJoin(agentTeams, eq(agentTeams.id, agentTeamRunsRuntime.teamId))
    .where(and(eq(agentTeamRunsRuntime.id, runId), eq(agentTeamRunsRuntime.organizationId, context.actor.organizationId)))
    .limit(1);
  if (!run) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");
  const steps = await db().select({
    position: agentTeamRunStepsRuntime.position,
    stepType: agentTeamRunStepsRuntime.stepType,
    status: agentTeamRunStepsRuntime.status,
    errorCode: agentTeamRunStepsRuntime.errorCode,
  }).from(agentTeamRunStepsRuntime).where(and(
    eq(agentTeamRunStepsRuntime.organizationId, context.actor.organizationId),
    eq(agentTeamRunStepsRuntime.teamRunId, run.id),
  )).orderBy(asc(agentTeamRunStepsRuntime.position));
  const canManage = await actorCan(context.actor, "agents:manage");
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← عمليات التشغيل ← التفاصيل",
    title: run.teamName ?? "تشغيل فريق",
    description: [
      `Run ID: ${run.id}`,
      `الحالة: ${run.status}`,
      `المحاولات: ${run.attempts}`,
      `المهمة: ${run.input}`,
      run.output?.trim() ? `النتيجة: ${run.output.trim()}` : "النتيجة: لم تكتمل بعد",
      run.errorCode ? `رمز الخطأ: ${run.errorCode}` : "",
      ...steps.map((step) => `الخطوة ${step.position}: ${step.stepType} — ${step.status}${step.errorCode ? ` — ${step.errorCode}` : ""}`),
    ].filter(Boolean).join("\n"),
    buttonRows: [
      ...(canManage && ["queued", "running", "waiting_approval"].includes(run.status) ? [[{ id: `run:c:${run.id}`, title: "طلب الإلغاء" }]] : []),
      ...(canManage && ["failed", "cancelled"].includes(run.status) ? [[{ id: `run:r:${run.id}`, title: "إعادة المحاولة" }]] : []),
      [{ id: "cap:runs.list:1", title: "رجوع" }, { id: `run:t:${run.id}`, title: "تحديث" }],
    ],
  });
}

export async function mutateTeamRun(context: TelegramActionContext, runId: string, action: "cancel" | "retry") {
  await assertActorPermission(context.actor, "agents:manage");
  const run = action === "cancel"
    ? await cancelAgentTeamRun(context.actor.organizationId, runId)
    : await retryAgentTeamRun(context.actor.organizationId, runId);
  await renderRunDetails(context, run.id);
}
