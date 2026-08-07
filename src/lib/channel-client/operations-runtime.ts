import { ApiError } from "@/lib/http/api";
import { resolveChannelCapabilities } from "./capability-registry";
import { sendChannelClientView, channelEmptyState } from "./message-renderer";
import {
  advanceChannelFlow,
  finishChannelFlow,
  startChannelFlow,
  type ChannelClientSession,
} from "./session-service";
import {
  channelBrowserDiagnostics,
  channelSandboxDiagnostics,
  createChannelTeamRun,
  decideChannelApproval,
  getChannelApproval,
  getChannelTeam,
  getChannelTeamRun,
  listChannelApprovals,
  listChannelTeamRuns,
  listChannelTeams,
  mutateChannelTeamRun,
} from "./operations-service";
import type { ChannelClientAction, ChannelClientRuntimeInput, ChannelClientRuntimeResult } from "./types";

function normalizedCommand(text: string) {
  return text.trim().toLocaleLowerCase("en-US").replace(/@\w+$/, "");
}

function operationAction(input: ChannelClientRuntimeInput) {
  if (input.actionId) return input.actionId;
  const aliases: Record<string, string> = {
    "/teams": "cc.teams:1",
    "الفرق": "cc.teams:1",
    "فرق الوكلاء": "cc.teams:1",
    "/runs": "cc.runs:1",
    "التشغيلات": "cc.runs:1",
    "عمليات التشغيل": "cc.runs:1",
    "/approvals": "cc.approvals",
    "الموافقات": "cc.approvals",
    "/browser": "cc.browser",
    "المتصفح": "cc.browser",
    "/sandbox": "cc.sandbox",
    "sandbox": "cc.sandbox",
    "ساندبوكس": "cc.sandbox",
  };
  return aliases[normalizedCommand(input.text)] ?? null;
}

async function hasCapability(input: ChannelClientRuntimeInput, id: string) {
  const capabilities = await resolveChannelCapabilities({ identity: input.identity, featureAllowed: input.featureAllowed });
  return capabilities.some((capability) => capability.id === id);
}

async function requireCapability(input: ChannelClientRuntimeInput, id: string, message: string) {
  if (!await hasCapability(input, id)) throw new ApiError(403, "CHANNEL_CAPABILITY_DENIED", message);
}

function pageButtons(current: number, pages: number, prefix: string) {
  const row: ChannelClientAction[] = [];
  if (current > 1) row.push({ id: `${prefix}:${current - 1}`, title: "السابق" });
  if (current < pages) row.push({ id: `${prefix}:${current + 1}`, title: "التالي" });
  row.push({ id: "cc.home", title: "الرئيسية" });
  return row;
}

export async function renderSharedChannelMainMenu(input: ChannelClientRuntimeInput) {
  const capabilities = await resolveChannelCapabilities({ identity: input.identity, featureAllowed: input.featureAllowed });
  const unique = [...new Map(capabilities.map((item) => [item.actionId, item])).values()];
  if (!unique.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد قدرات متاحة",
      reason: "لا توجد وحدة وصلاحية قناة مفعلة لهذا الحساب حاليًا.",
      path: ["الرئيسية"],
    }));
    return;
  }
  const smart = unique.filter((item) => ["chat.start", "agents.list", "agents.create", "teams.list", "runs.list"].includes(item.id));
  const content = unique.filter((item) => ["files.receive"].includes(item.id));
  const operations = unique.filter((item) => ["approvals.list", "browser.list", "sandbox.list"].includes(item.id));
  const account = unique.filter((item) => item.id === "account.status");
  const sections = [
    smart.length ? `العمل الذكي: ${smart.map((item) => item.labelAr).join("، ")}` : null,
    content.length ? `المحتوى والمعرفة: ${content.map((item) => item.labelAr).join("، ")}` : null,
    operations.length ? `التشغيل: ${operations.map((item) => item.labelAr).join("، ")}` : null,
    account.length ? `الحساب: ${account.map((item) => item.labelAr).join("، ")}` : null,
  ].filter(Boolean);
  const actions = [...smart, ...content, ...operations, ...account].map((item) => ({
    id: item.actionId,
    title: `${item.icon ? `${item.icon} ` : ""}${item.labelAr}`,
  }));
  const rows: ChannelClientAction[][] = [];
  for (let index = 0; index < actions.length; index += 2) rows.push(actions.slice(index, index + 2));
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية"],
    text: `${sections.join("\n")}\n\nلا يظهر أي خيار إلا إذا كانت الوحدة مفعلة، وصلاحية RBAC متاحة، وصلاحية القناة مفعلة، والتنفيذ الخلفي موجود.`,
    actions: rows,
    editCurrent: Boolean(input.actionId),
  });
}

async function teamsView(input: ChannelClientRuntimeInput, page: number) {
  await requireCapability(input, "teams.list", "فرق الوكلاء غير متاحة لحسابك.");
  const result = await listChannelTeams({
    organizationId: input.identity.organizationId,
    userId: input.identity.userId,
    page,
  });
  if (!result.rows.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد فرق وكلاء",
      reason: "لا توجد فرق مفعلة في المؤسسة. أنشئ فريقًا من لوحة التحكم بعد نشر وكلائه.",
      action: { id: "cc.home", title: "الرئيسية" },
      path: ["الرئيسية", "فرق الوكلاء"],
    }));
    return;
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "فرق الوكلاء"],
    text: result.rows.map((team, index) => [
      `${(result.page - 1) * 5 + index + 1}. ${team.name}`,
      team.description || "بدون وصف",
      `الأعضاء: ${team.members.map((member) => `${member.agentName} (${member.role})`).join("، ") || "لا يوجد"}`,
      `الجاهزية: ${team.ready ? "جاهز" : "غير جاهز"}`,
      `آخر تحديث: ${team.updatedAt.toLocaleString("ar-SA")}`,
    ].join("\n")).join("\n\n"),
    actions: [
      ...result.rows.map((team) => [{ id: `cc.team:${team.id}`, title: team.name.slice(0, 55) }]),
      pageButtons(result.page, result.pages, "cc.teams"),
    ],
    editCurrent: Boolean(input.actionId),
  });
}

async function teamView(input: ChannelClientRuntimeInput, teamId: string) {
  await requireCapability(input, "teams.list", "فرق الوكلاء غير متاحة لحسابك.");
  const team = await getChannelTeam({ organizationId: input.identity.organizationId, userId: input.identity.userId, teamId });
  const canRun = team.ready && await hasCapability(input, "teams.run");
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "فرق الوكلاء", "التفاصيل"],
    text: [
      team.name,
      team.description || "بدون وصف",
      `الجاهزية: ${team.ready ? "جاهز" : "غير جاهز؛ يجب نشر أعضاء الفريق المطلوبين"}`,
      ...team.members.map((member, index) => `${index + 1}. ${member.agentName} — ${member.role} — ${member.agentStatus}`),
    ].join("\n"),
    actions: [
      ...(canRun ? [[{ id: `cc.teamrun:${team.id}`, title: "تشغيل الفريق" }]] : []),
      [{ id: "cc.teams:1", title: "رجوع" }, { id: "cc.home", title: "الرئيسية" }],
    ],
    editCurrent: Boolean(input.actionId),
  });
}

async function beginTeamRun(input: ChannelClientRuntimeInput, teamId: string) {
  await requireCapability(input, "teams.run", "تشغيل فرق الوكلاء غير متاح لحسابك.");
  const team = await getChannelTeam({ organizationId: input.identity.organizationId, userId: input.identity.userId, teamId });
  if (!team.ready) throw new ApiError(422, "TEAM_NOT_READY", "الفريق غير جاهز للتشغيل.");
  const session = await startChannelFlow(input.session, "team.run", "input", { teamId: team.id, teamName: team.name });
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "فرق الوكلاء", "تشغيل"],
    text: `أرسل المهمة المطلوب تنفيذها بواسطة «${team.name}». لن يبدأ التشغيل قبل شاشة التأكيد.`,
    actions: [[{ id: "cc.cancel", title: "إلغاء" }]],
  });
  return session;
}

async function teamRunFlow(input: ChannelClientRuntimeInput, action: string | null) {
  let session = input.session;
  if (action === "cc.cancel") {
    session = await finishChannelFlow(session);
    await sendChannelClientView(input.transport, { text: "تم إلغاء تشغيل الفريق قبل إنشائه.", actions: [[{ id: "cc.home", title: "الرئيسية" }]] });
    return { session };
  }
  const state = session.state as { teamId?: string; teamName?: string; prompt?: string };
  if (session.currentStep === "input") {
    const prompt = input.text.trim();
    if (!prompt || prompt.length > 20_000) throw new ApiError(422, "TEAM_INPUT_INVALID", "المهمة مطلوبة ويجب ألا تتجاوز 20000 حرف.");
    session = await advanceChannelFlow(session, "confirm", { ...state, prompt });
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "فرق الوكلاء", "تأكيد التشغيل"],
      text: `الفريق: ${state.teamName ?? "الفريق المختار"}\n\nالمهمة:\n${prompt}\n\nلن يبدأ التنفيذ قبل التأكيد.`,
      actions: [[{ id: "cc.teamrun.confirm", title: "تأكيد التشغيل" }, { id: "cc.cancel", title: "إلغاء" }]],
    });
    return { session };
  }
  if (session.currentStep === "confirm") {
    if (action !== "cc.teamrun.confirm") return { session };
    if (!state.teamId || !state.prompt) throw new ApiError(409, "TEAM_FLOW_INCOMPLETE", "بيانات تشغيل الفريق غير مكتملة.");
    const run = await createChannelTeamRun({
      organizationId: input.identity.organizationId,
      userId: input.identity.userId,
      teamId: state.teamId,
      prompt: state.prompt,
      requestId: `${input.identity.channel}:${input.incoming.eventId}:team-run`,
    });
    session = await finishChannelFlow(session, { selectedTeamId: state.teamId });
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "عمليات التشغيل"],
      text: `تم إنشاء تشغيل الفريق فعليًا.\nالحالة: ${run.status}\nيمكن متابعة الحالة والخطوات من القناة أو لوحة الموقع.`,
      actions: [[{ id: `cc.run:${run.id}`, title: "متابعة التشغيل" }, { id: "cc.runs:1", title: "كل التشغيلات" }]],
    });
    return { session, runId: run.id };
  }
  throw new ApiError(409, "TEAM_FLOW_INVALID", "حالة تشغيل الفريق غير صالحة.");
}

async function runsView(input: ChannelClientRuntimeInput, page: number) {
  await requireCapability(input, "runs.list", "عمليات التشغيل غير متاحة لحسابك.");
  const result = await listChannelTeamRuns({ organizationId: input.identity.organizationId, userId: input.identity.userId, page });
  if (!result.rows.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد عمليات تشغيل",
      reason: "ابدأ تشغيلًا حقيقيًا من قسم فرق الوكلاء.",
      action: { id: "cc.teams:1", title: "فرق الوكلاء" },
      path: ["الرئيسية", "عمليات التشغيل"],
    }));
    return;
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "عمليات التشغيل"],
    text: result.rows.map((run, index) => [
      `${(result.page - 1) * 5 + index + 1}. ${run.teamName ?? "فريق غير متاح"}`,
      `الحالة: ${run.status}`,
      `المحاولات: ${run.attempts}`,
      `الخطأ: ${run.errorCode ?? "لا يوجد"}`,
      `البدء: ${run.createdAt.toLocaleString("ar-SA")}`,
    ].join("\n")).join("\n\n"),
    actions: [
      ...result.rows.map((run) => [{ id: `cc.run:${run.id}`, title: `عرض ${run.teamName ?? "التشغيل"}`.slice(0, 55) }]),
      pageButtons(result.page, result.pages, "cc.runs"),
    ],
    editCurrent: Boolean(input.actionId),
  });
}

async function runView(input: ChannelClientRuntimeInput, runId: string) {
  const run = await getChannelTeamRun({ organizationId: input.identity.organizationId, userId: input.identity.userId, runId });
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "عمليات التشغيل", "التفاصيل"],
    text: [
      `الفريق: ${run.teamName ?? "غير متاح"}`,
      `الحالة: ${run.status}`,
      `المحاولات: ${run.attempts}`,
      `الخطأ: ${run.errorCode ?? "لا يوجد"}`,
      `الخطوات: ${run.steps.length}`,
      ...run.steps.slice(0, 10).map((step) => `• الخطوة ${step.position}: ${step.status}${step.errorCode ? ` — ${step.errorCode}` : ""}`),
    ].join("\n"),
    actions: [
      ...(!terminal ? [[{ id: `cc.run.cancel.confirm:${run.id}`, title: "إلغاء التشغيل" }]] : []),
      ...(run.status === "failed" || run.status === "cancelled" ? [[{ id: `cc.run.retry.confirm:${run.id}`, title: "إعادة المحاولة" }]] : []),
      [{ id: "cc.runs:1", title: "رجوع" }, { id: "cc.home", title: "الرئيسية" }],
    ],
    editCurrent: Boolean(input.actionId),
  });
}

async function approvalList(input: ChannelClientRuntimeInput) {
  await requireCapability(input, "approvals.list", "الموافقات غير متاحة لحسابك.");
  const approvals = await listChannelApprovals({ organizationId: input.identity.organizationId, userId: input.identity.userId });
  if (!approvals.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: "لا توجد موافقات معلقة",
      reason: "ستظهر هنا فقط طلبات الأدوات الحقيقية التي تنتظر قرارًا.",
      action: { id: "cc.home", title: "الرئيسية" },
      path: ["الرئيسية", "الموافقات"],
    }));
    return;
  }
  const visible = approvals.slice(0, 6);
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "الموافقات"],
    text: visible.map((approval, index) => [
      `${index + 1}. ${approval.toolName}`,
      `الوكيل: ${approval.agentName}`,
      `المصدر: ${approval.serverName}`,
      `المخاطر: ${approval.risk}`,
      `تنتهي: ${approval.expiresAt.toLocaleString("ar-SA")}`,
    ].join("\n")).join("\n\n"),
    actions: [
      ...visible.map((approval) => [{ id: `cc.approval:${approval.approvalId}`, title: `مراجعة ${approval.toolName}`.slice(0, 55) }]),
      [{ id: "cc.approvals", title: "تحديث" }, { id: "cc.home", title: "الرئيسية" }],
    ],
    editCurrent: Boolean(input.actionId),
  });
}

async function approvalView(input: ChannelClientRuntimeInput, approvalId: string) {
  const approval = await getChannelApproval({ organizationId: input.identity.organizationId, userId: input.identity.userId, approvalId });
  const summary = Object.entries(approval.argumentsSummary ?? {}).slice(0, 10)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n");
  const pending = approval.status === "pending" && approval.expiresAt > new Date();
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "الموافقات", "التفاصيل"],
    text: [
      `الأداة: ${approval.toolName}`,
      `الوكيل: ${approval.agentName}`,
      `المصدر: ${approval.serverName}`,
      `المخاطر: ${approval.risk}`,
      `السبب: ${approval.reason || "غير محدد"}`,
      `الحالة: ${approval.status}`,
      summary ? `المدخلات المنقحة:\n${summary}` : "لا توجد مدخلات قابلة للعرض.",
    ].join("\n\n"),
    actions: pending
      ? [[
          { id: `cc.approval.confirm.a:${approval.approvalId}`, title: "موافقة" },
          { id: `cc.approval.confirm.r:${approval.approvalId}`, title: "رفض" },
        ], [{ id: "cc.approvals", title: "رجوع" }]]
      : [[{ id: "cc.approvals", title: "رجوع" }, { id: "cc.home", title: "الرئيسية" }]],
    editCurrent: Boolean(input.actionId),
  });
}

async function browserView(input: ChannelClientRuntimeInput) {
  await requireCapability(input, "browser.list", "تشخيص Browser غير متاح لحسابك.");
  const { health, tasks } = await channelBrowserDiagnostics({ organizationId: input.identity.organizationId, userId: input.identity.userId });
  if (!tasks.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: `Browser Runner: ${health.status}`,
      reason: `${health.details} لا توجد مهام متصفح متاحة لحسابك.`,
      action: { id: "cc.home", title: "الرئيسية" },
      path: ["الرئيسية", "مهام المتصفح"],
    }));
    return;
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "مهام المتصفح"],
    text: [`حالة Runner: ${health.status} — ${health.details}`, ...tasks.map((task, index) => [
      `${index + 1}. ${task.connectionName} — ${task.siteDomain}`,
      `الوكيل: ${task.agentName}`,
      `الحالة: ${task.status}`,
      `المخاطر: ${task.riskLevel}`,
      `الخطوة: ${task.currentStep}`,
      `الخطأ: ${task.errorCode ?? "لا يوجد"}`,
    ].join("\n"))].join("\n\n"),
    actions: [[{ id: "cc.browser", title: "تحديث" }, { id: "cc.home", title: "الرئيسية" }]],
    editCurrent: Boolean(input.actionId),
  });
}

async function sandboxView(input: ChannelClientRuntimeInput) {
  await requireCapability(input, "sandbox.list", "تشخيص Sandbox غير متاح لحسابك.");
  const { health, workspaces, executions } = await channelSandboxDiagnostics({ organizationId: input.identity.organizationId, userId: input.identity.userId });
  const items = [
    ...workspaces.slice(0, 6).map((workspace) => `مساحة: ${workspace.name}\nالحالة: ${workspace.status}\nالقالب: ${workspace.template}\nالمزود: ${workspace.provider}\nالخطأ: ${workspace.errorCode ?? "لا يوجد"}`),
    ...executions.slice(0, 8).map((execution) => `تنفيذ: ${execution.commandSummary}\nالحالة: ${execution.status}\nالمخاطر: ${execution.riskLevel}\nرمز الخروج: ${execution.exitCode ?? "لم يكتمل"}\nالخطأ: ${execution.errorCode ?? "لا يوجد"}`),
  ];
  if (!items.length) {
    await sendChannelClientView(input.transport, channelEmptyState({
      title: `Sandbox Runner: ${health.status}`,
      reason: `${health.details} لا توجد مساحات أو تنفيذات متاحة لحسابك.`,
      action: { id: "cc.home", title: "الرئيسية" },
      path: ["الرئيسية", "Sandbox"],
    }));
    return;
  }
  await sendChannelClientView(input.transport, {
    path: ["الرئيسية", "Sandbox"],
    text: [`حالة Runner: ${health.status} — ${health.details}`, ...items].join("\n\n"),
    actions: [[{ id: "cc.sandbox", title: "تحديث" }, { id: "cc.home", title: "الرئيسية" }]],
    editCurrent: Boolean(input.actionId),
  });
}

export async function processChannelOperations(input: ChannelClientRuntimeInput): Promise<ChannelClientRuntimeResult | null> {
  let session = input.session;
  const action = operationAction(input);
  if (input.actionId) await input.transport.answerCallback?.();

  if (session.activeFlow === "team.run") {
    const result = await teamRunFlow(input, action);
    return { handled: true, session: result.session, runId: result.runId };
  }
  if (action === "cc.home") {
    await renderSharedChannelMainMenu(input);
    return { handled: true, session };
  }
  const teamsPage = /^cc\.teams:(\d+)$/.exec(action ?? "");
  if (teamsPage) {
    await teamsView(input, Number(teamsPage[1]));
    return { handled: true, session };
  }
  const team = /^cc\.team:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (team) {
    await teamView(input, team[1]);
    return { handled: true, session };
  }
  const teamRun = /^cc\.teamrun:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (teamRun) {
    session = await beginTeamRun(input, teamRun[1]);
    return { handled: true, session };
  }
  const runsPage = /^cc\.runs:(\d+)$/.exec(action ?? "");
  if (runsPage) {
    await runsView(input, Number(runsPage[1]));
    return { handled: true, session };
  }
  const run = /^cc\.run:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (run) {
    await runView(input, run[1]);
    return { handled: true, session };
  }
  const runConfirm = /^cc\.run\.(cancel|retry)\.confirm:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (runConfirm) {
    await sendChannelClientView(input.transport, {
      path: ["الرئيسية", "عمليات التشغيل", "تأكيد"],
      text: runConfirm[1] === "cancel" ? "تأكيد إلغاء التشغيل؟" : "تأكيد إعادة محاولة التشغيل؟",
      actions: [[
        { id: `cc.run.${runConfirm[1]}.execute:${runConfirm[2]}`, title: "تأكيد" },
        { id: `cc.run:${runConfirm[2]}`, title: "رجوع" },
      ]],
    });
    return { handled: true, session };
  }
  const runExecute = /^cc\.run\.(cancel|retry)\.execute:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (runExecute) {
    const result = await mutateChannelTeamRun({
      organizationId: input.identity.organizationId,
      userId: input.identity.userId,
      runId: runExecute[2],
      operation: runExecute[1] as "cancel" | "retry",
    });
    await sendChannelClientView(input.transport, {
      text: `تم تنفيذ العملية فعليًا. الحالة الحالية: ${result.status}.`,
      actions: [[{ id: `cc.run:${runExecute[2]}`, title: "عرض التشغيل" }, { id: "cc.runs:1", title: "التشغيلات" }]],
    });
    return { handled: true, session };
  }
  if (action === "cc.approvals") {
    await approvalList(input);
    return { handled: true, session };
  }
  const approval = /^cc\.approval:([0-9a-f-]{36})$/i.exec(action ?? "");
  if (approval) {
    await approvalView(input, approval[1]);
    return { handled: true, session };
  }
  const approvalConfirm = /^cc\.approval\.confirm\.(a|r):([0-9a-f-]{36})$/i.exec(action ?? "");
  if (approvalConfirm) {
    const approvalRow = await getChannelApproval({ organizationId: input.identity.organizationId, userId: input.identity.userId, approvalId: approvalConfirm[2] });
    await sendChannelClientView(input.transport, {
      text: `${approvalConfirm[1] === "a" ? "تأكيد الموافقة" : "تأكيد الرفض"}\nالأداة: ${approvalRow.toolName}\nالمخاطر: ${approvalRow.risk}`,
      actions: [[
        { id: `cc.approval.execute.${approvalConfirm[1]}:${approvalConfirm[2]}`, title: "تأكيد القرار" },
        { id: `cc.approval:${approvalConfirm[2]}`, title: "رجوع" },
      ]],
    });
    return { handled: true, session };
  }
  const approvalExecute = /^cc\.approval\.execute\.(a|r):([0-9a-f-]{36})$/i.exec(action ?? "");
  if (approvalExecute) {
    const result = await decideChannelApproval({
      organizationId: input.identity.organizationId,
      userId: input.identity.userId,
      approvalId: approvalExecute[2],
      approved: approvalExecute[1] === "a",
      source: input.identity.channel,
    });
    await sendChannelClientView(input.transport, {
      text: `${approvalExecute[1] === "a" ? "تمت الموافقة" : "تم الرفض"} فعليًا، وأُرسل القرار لمسار الاستئناف. الحالة: ${result.approval.status}.`,
      actions: [[{ id: "cc.approvals", title: "الموافقات" }, { id: "cc.home", title: "الرئيسية" }]],
    });
    return { handled: true, session };
  }
  if (action === "cc.browser") {
    await browserView(input);
    return { handled: true, session };
  }
  if (action === "cc.sandbox") {
    await sandboxView(input);
    return { handled: true, session };
  }
  return null;
}
