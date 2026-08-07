import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentTeamRunsRuntime, agentTeamRunStepsRuntime } from "@/db/agent-runtime-schema";
import { agentTeamMembers, agentTeams, agents } from "@/db/schema";
import {
  cancelAgentTeamRun,
  createAgentTeamRun,
  retryAgentTeamRun,
} from "@/lib/agents/team-runtime";
import { ApiError } from "@/lib/http/api";
import { assertTelegramCapability } from "./capability-registry";
import { sendTelegramEmptyState, sendTelegramList, sendTelegramMenu } from "./message-renderer";
import { advanceTelegramFlow, beginTelegramFlow, cancelTelegramFlow, getTelegramSession } from "./session-service";

type TeamContext = {
  token: string;
  chatId: string;
  telegramUserId: string;
  userId: string;
  organizationId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 5;

async function assertTeamCapability(input: TeamContext, capabilityId: "teams.list" | "teams.run" | "runs.list") {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId,
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_CAPABILITY_DENIED", "هذه العملية غير متاحة لحسابك.");
}

export async function listTelegramTeams(input: TeamContext & { page?: number }) {
  await assertTeamCapability(input, "teams.list");
  const page = Math.max(1, input.page ?? 1);
  const where = and(eq(agentTeams.organizationId, input.organizationId), eq(agentTeams.enabled, true));
  const [teams, totals] = await Promise.all([
    db().select({
      id: agentTeams.id,
      name: agentTeams.name,
      description: agentTeams.description,
      maxParallelWorkers: agentTeams.maxParallelWorkers,
      updatedAt: agentTeams.updatedAt,
    }).from(agentTeams).where(where).orderBy(desc(agentTeams.updatedAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().select({ value: count() }).from(agentTeams).where(where),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (!teams.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا توجد فرق وكلاء مفعلة في المؤسسة.",
      action: "أنشئ فريقًا من لوحة التحكم بعد نشر وكلاء الفريق.",
      buttonRows: [[{ url: "https://moatazalalqami.online/dashboard/teams", title: "فتح فرق الوكلاء" }], [{ id: "nav:home", title: "الرئيسية" }]],
    });
    return;
  }
  const memberships = await db().select({
    teamId: agentTeamMembers.teamId,
    role: agentTeamMembers.role,
    agentName: agents.name,
    agentStatus: agents.status,
  }).from(agentTeamMembers)
    .innerJoin(agents, eq(agents.id, agentTeamMembers.agentId))
    .where(and(
      eq(agentTeamMembers.organizationId, input.organizationId),
      inArray(agentTeamMembers.teamId, teams.map((team) => team.id)),
    )).orderBy(asc(agentTeamMembers.position));
  const buttons = teams.map((team) => [{ id: `team:view:${team.id}`, title: team.name.slice(0, 55) }]);
  const navigation = [] as Array<{ id: string; title: string }>;
  if (page > 1) navigation.push({ id: `teams:page:${page - 1}`, title: "السابق" });
  if (page < pages) navigation.push({ id: `teams:page:${page + 1}`, title: "التالي" });
  navigation.push({ id: "nav:home", title: "الرئيسية" });
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: `الرئيسية ← العمل الذكي ← فرق الوكلاء\nالصفحة ${page} من ${pages}`,
    items: teams.map((team, index) => {
      const members = memberships.filter((member) => member.teamId === team.id);
      const readiness = members.length > 1 && members.every((member) => member.agentStatus === "published")
        ? "جاهز"
        : "غير جاهز";
      return [
        `${(page - 1) * PAGE_SIZE + index + 1}. ${team.name}`,
        team.description || "بدون وصف",
        `الأعضاء: ${members.map((member) => `${member.agentName} (${member.role})`).join("، ") || "لا يوجد"}`,
        `الحالة: ${readiness}`,
        `آخر تحديث: ${team.updatedAt.toLocaleString("ar-SA")}`,
      ].join("\n");
    }),
    emptyText: "لا توجد فرق.",
    buttonRows: [...buttons, navigation],
  });
}

export async function showTelegramTeam(input: TeamContext & { teamId: string }) {
  await assertTeamCapability(input, "teams.list");
  if (!UUID.test(input.teamId)) throw new ApiError(422, "TEAM_ID_INVALID", "معرّف الفريق غير صالح.");
  const [team] = await db().select().from(agentTeams).where(and(
    eq(agentTeams.id, input.teamId),
    eq(agentTeams.organizationId, input.organizationId),
    eq(agentTeams.enabled, true),
  )).limit(1);
  if (!team) throw new ApiError(404, "AGENT_TEAM_NOT_FOUND", "فريق الوكلاء غير موجود أو معطل.");
  const members = await db().select({
    role: agentTeamMembers.role,
    position: agentTeamMembers.position,
    agentName: agents.name,
    agentStatus: agents.status,
  }).from(agentTeamMembers)
    .innerJoin(agents, eq(agents.id, agentTeamMembers.agentId))
    .where(and(
      eq(agentTeamMembers.organizationId, input.organizationId),
      eq(agentTeamMembers.teamId, team.id),
    )).orderBy(asc(agentTeamMembers.position));
  const runCapability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "teams.run",
  });
  const runnable = members.length > 1 && members.every((member) => member.agentStatus === "published");
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: [
      "الرئيسية ← العمل الذكي ← فرق الوكلاء ← التفاصيل",
      team.name,
      team.description || "بدون وصف",
      `التوازي الأقصى: ${team.maxParallelWorkers}`,
      `الجاهزية: ${runnable ? "جاهز" : "غير جاهز؛ يجب نشر المشرف وعامل واحد على الأقل"}`,
      ...members.map((member, index) => `${index + 1}. ${member.agentName} — ${member.role} — ${member.agentStatus}`),
    ].join("\n"),
    buttonRows: [
      ...(runCapability && runnable ? [[{ id: `team:run:${team.id}`, title: "تشغيل الفريق" }]] : []),
      [{ id: "teams:page:1", title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function startTelegramTeamRun(input: TeamContext & { teamId: string }) {
  await assertTeamCapability(input, "teams.run");
  const [team] = await db().select({ id: agentTeams.id, name: agentTeams.name }).from(agentTeams).where(and(
    eq(agentTeams.id, input.teamId),
    eq(agentTeams.organizationId, input.organizationId),
    eq(agentTeams.enabled, true),
  )).limit(1);
  if (!team) throw new ApiError(404, "AGENT_TEAM_NOT_FOUND", "فريق الوكلاء غير موجود أو معطل.");
  await beginTelegramFlow({
    telegramUserId: input.telegramUserId,
    flow: "team.run",
    step: "input",
    selectedTeamId: team.id,
    state: { teamName: team.name },
  });
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: `تشغيل «${team.name}»\nأرسل المهمة المطلوبة. ستُحفظ أولًا ثم يظهر تأكيد صريح قبل إنشاء التشغيل الحقيقي.`,
    buttonRows: [[{ id: "flow:cancel", title: "إلغاء" }]],
  });
}

export async function handleTelegramTeamRunText(input: TeamContext & { text: string }) {
  const session = await getTelegramSession(input.telegramUserId);
  if (session?.activeFlow !== "team.run") return false;
  if (session.currentStep !== "input" || !session.selectedTeamId) {
    throw new ApiError(409, "TELEGRAM_FLOW_STEP_INVALID", "حالة تشغيل الفريق غير مكتملة.");
  }
  const prompt = input.text.trim();
  if (!prompt || prompt.length > 20_000) {
    throw new ApiError(422, "TEAM_INPUT_INVALID", "مهمة الفريق مطلوبة ويجب ألا تتجاوز 20000 حرف.");
  }
  const advanced = await advanceTelegramFlow({
    sessionId: session.id,
    expectedVersion: session.version,
    step: "confirm",
    state: { ...session.state, prompt },
  });
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: `تأكيد تشغيل الفريق\nالفريق: ${String(advanced.state.teamName ?? "الفريق المختار")}\n\nالمهمة:\n${prompt}`,
    buttonRows: [[{ id: "team:run:confirm", title: "تأكيد التشغيل" }], [{ id: "flow:cancel", title: "إلغاء" }]],
  });
  return true;
}

export async function confirmTelegramTeamRun(input: TeamContext & { requestId: string }) {
  await assertTeamCapability(input, "teams.run");
  const session = await getTelegramSession(input.telegramUserId);
  if (session?.activeFlow !== "team.run" || session.currentStep !== "confirm" || !session.selectedTeamId) {
    throw new ApiError(409, "CONFIRMATION_REQUIRED", "لا يوجد تشغيل فريق صالح بانتظار التأكيد.");
  }
  const prompt = typeof session.state.prompt === "string" ? session.state.prompt.trim() : "";
  if (!prompt) throw new ApiError(409, "TEAM_INPUT_INVALID", "مهمة الفريق مفقودة.");
  const run = await createAgentTeamRun({
    organizationId: input.organizationId,
    teamId: session.selectedTeamId,
    prompt,
    requestId: input.requestId,
    userId: input.userId,
  });
  await cancelTelegramFlow(input.telegramUserId);
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: `تم إنشاء تشغيل الفريق فعليًا.\nالحالة: ${run.status}\nيمكن متابعة خطواته من Telegram أو لوحة العمليات.`,
    buttonRows: [[{ id: `run:view:${run.id}`, title: "متابعة التشغيل" }], [{ id: "runs:page:1", title: "كل العمليات" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function listTelegramRuns(input: TeamContext & { page?: number }) {
  await assertTeamCapability(input, "runs.list");
  const page = Math.max(1, input.page ?? 1);
  const where = eq(agentTeamRunsRuntime.organizationId, input.organizationId);
  const [runs, totals] = await Promise.all([
    db().select({
      id: agentTeamRunsRuntime.id,
      teamName: agentTeams.name,
      status: agentTeamRunsRuntime.status,
      errorCode: agentTeamRunsRuntime.errorCode,
      attempts: agentTeamRunsRuntime.attempts,
      createdAt: agentTeamRunsRuntime.createdAt,
    }).from(agentTeamRunsRuntime)
      .leftJoin(agentTeams, eq(agentTeams.id, agentTeamRunsRuntime.teamId))
      .where(where).orderBy(desc(agentTeamRunsRuntime.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().select({ value: count() }).from(agentTeamRunsRuntime).where(where),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (!runs.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا توجد عمليات فرق وكلاء في المؤسسة.",
      action: "ابدأ تشغيلًا من قسم فرق الوكلاء.",
      buttonRows: [[{ id: "teams:page:1", title: "فرق الوكلاء" }, { id: "nav:home", title: "الرئيسية" }]],
    });
    return;
  }
  const navigation = [] as Array<{ id: string; title: string }>;
  if (page > 1) navigation.push({ id: `runs:page:${page - 1}`, title: "السابق" });
  if (page < pages) navigation.push({ id: `runs:page:${page + 1}`, title: "التالي" });
  navigation.push({ id: "nav:home", title: "الرئيسية" });
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: `الرئيسية ← العمل الذكي ← عمليات التشغيل\nالصفحة ${page} من ${pages}`,
    items: runs.map((run, index) => [
      `${(page - 1) * PAGE_SIZE + index + 1}. ${run.teamName ?? "فريق محذوف"}`,
      `الحالة: ${run.status}`,
      `المحاولات: ${run.attempts}`,
      `الخطأ: ${run.errorCode ?? "لا يوجد"}`,
      `البدء: ${run.createdAt.toLocaleString("ar-SA")}`,
    ].join("\n")),
    emptyText: "لا توجد عمليات.",
    buttonRows: [
      ...runs.map((run) => [{ id: `run:view:${run.id}`, title: `${run.teamName ?? "تشغيل"} — ${run.status}`.slice(0, 58) }]),
      navigation,
    ],
  });
}

export async function showTelegramRun(input: TeamContext & { runId: string }) {
  await assertTeamCapability(input, "runs.list");
  if (!UUID.test(input.runId)) throw new ApiError(422, "TEAM_RUN_ID_INVALID", "معرّف التشغيل غير صالح.");
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
    .where(and(eq(agentTeamRunsRuntime.id, input.runId), eq(agentTeamRunsRuntime.organizationId, input.organizationId)))
    .limit(1);
  if (!run) throw new ApiError(404, "TEAM_RUN_NOT_FOUND", "تشغيل الفريق غير موجود.");
  const steps = await db().select({
    stepType: agentTeamRunStepsRuntime.stepType,
    position: agentTeamRunStepsRuntime.position,
    status: agentTeamRunStepsRuntime.status,
    errorCode: agentTeamRunStepsRuntime.errorCode,
  }).from(agentTeamRunStepsRuntime).where(and(
    eq(agentTeamRunStepsRuntime.organizationId, input.organizationId),
    eq(agentTeamRunStepsRuntime.teamRunId, run.id),
  )).orderBy(asc(agentTeamRunStepsRuntime.position));
  const buttons = [] as Array<Array<{ id: string; title: string }>>;
  if (["queued", "running", "waiting_approval"].includes(run.status)) {
    buttons.push([{ id: `run:cancel:confirm:${run.id}`, title: "إلغاء التشغيل" }]);
  }
  if (run.status === "failed") buttons.push([{ id: `run:retry:confirm:${run.id}`, title: "إعادة المحاولة" }]);
  buttons.push([{ id: "runs:page:1", title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }]);
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: [
      "الرئيسية ← العمل الذكي ← عمليات التشغيل ← التفاصيل",
      `الفريق: ${run.teamName ?? "فريق محذوف"}`,
      `الحالة: ${run.status}`,
      `المحاولات: ${run.attempts}`,
      `المهمة: ${run.input.slice(0, 900)}`,
      `النتيجة: ${run.output?.trim() ? run.output.slice(0, 1400) : "لا توجد نتيجة بعد"}`,
      `الخطأ: ${run.errorCode ?? "لا يوجد"}`,
      `الخطوات: ${steps.length ? steps.map((step) => `${step.position + 1}. ${step.stepType} — ${step.status}${step.errorCode ? ` — ${step.errorCode}` : ""}`).join("\n") : "لم تبدأ الخطوات بعد"}`,
      `بدأ: ${run.startedAt?.toLocaleString("ar-SA") ?? run.createdAt.toLocaleString("ar-SA")}`,
      `اكتمل: ${run.completedAt?.toLocaleString("ar-SA") ?? "لا"}`,
    ].join("\n\n"),
    buttonRows: buttons,
  });
}

export async function confirmTelegramRunMutation(input: TeamContext & {
  runId: string;
  operation: "cancel" | "retry";
}) {
  await assertTeamCapability(input, input.operation === "cancel" ? "teams.run" : "teams.run");
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: input.operation === "cancel"
      ? "تأكيد إلغاء تشغيل الفريق. قد تتوقف الخطوات التي لم تبدأ بعد."
      : "تأكيد إعادة محاولة تشغيل الفريق الفاشل.",
    buttonRows: [[{
      id: `run:${input.operation}:execute:${input.runId}`,
      title: input.operation === "cancel" ? "تأكيد الإلغاء" : "تأكيد الإعادة",
    }], [{ id: `run:view:${input.runId}`, title: "رجوع" }]],
  });
}

export async function executeTelegramRunMutation(input: TeamContext & {
  runId: string;
  operation: "cancel" | "retry";
}) {
  await assertTeamCapability(input, "teams.run");
  const run = input.operation === "cancel"
    ? await cancelAgentTeamRun(input.organizationId, input.runId)
    : await retryAgentTeamRun(input.organizationId, input.runId);
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: `${input.operation === "cancel" ? "تم طلب إلغاء التشغيل" : "تمت إعادة جدولة التشغيل"}.\nالحالة الحالية: ${run.status}`,
    buttonRows: [[{ id: `run:view:${run.id}`, title: "عرض التشغيل" }, { id: "runs:page:1", title: "كل العمليات" }]],
  });
}
