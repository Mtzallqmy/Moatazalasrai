import { userOrganizationRole } from "@/lib/auth/user-authorization";
import { listBrowserTasks } from "@/lib/browser/task-service";
import { ApiError } from "@/lib/http/api";
import { listSandboxExecutions, listSandboxWorkspaces } from "@/lib/sandbox/service";
import { assertTelegramCapability } from "./capability-registry";
import { sendTelegramEmptyState, sendTelegramList } from "./message-renderer";

type RuntimeContext = {
  token: string;
  chatId: string;
  userId: string;
  organizationId: string;
};

async function assertRuntimeCapability(
  input: RuntimeContext,
  capabilityId: "browser.list" | "sandbox.list",
) {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId,
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_CAPABILITY_DENIED", "ميزة التشغيل المطلوبة غير متاحة لحسابك.");
}

export async function listTelegramBrowserTasks(input: RuntimeContext) {
  await assertRuntimeCapability(input, "browser.list");
  const role = await userOrganizationRole(input.userId, input.organizationId);
  const tasks = await listBrowserTasks({
    organizationId: input.organizationId,
    userId: input.userId,
    role,
    limit: 12,
  });
  if (!tasks.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا توجد مهام متصفح متاحة لحسابك.",
      action: "أنشئ مهمة من صفحة مهام المتصفح بعد توثيق اتصال الموقع وربطه بوكيل.",
      buttonRows: [[{ url: "https://moatazalalqami.online/dashboard/browser-tasks", title: "فتح مهام المتصفح" }], [{ id: "nav:home", title: "الرئيسية" }]],
    });
    return;
  }
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: `الرئيسية ← التشغيل ← مهام المتصفح\nآخر ${tasks.length} مهمة`,
    items: tasks.map((task, index) => [
      `${index + 1}. ${task.connectionName} — ${task.siteDomain}`,
      `الوكيل: ${task.agentName}`,
      `المهمة: ${task.instruction.slice(0, 600)}`,
      `الحالة: ${task.status}`,
      `المخاطر: ${task.riskLevel}`,
      `الخطوة: ${task.currentStep}`,
      `الخطأ: ${task.errorCode ?? "لا يوجد"}`,
      `أضيفت: ${task.createdAt.toLocaleString("ar-SA")}`,
    ].join("\n")),
    emptyText: "لا توجد مهام متصفح.",
    buttonRows: [[{ id: "browser:list", title: "تحديث" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function listTelegramSandboxRuntime(input: RuntimeContext) {
  await assertRuntimeCapability(input, "sandbox.list");
  const role = await userOrganizationRole(input.userId, input.organizationId);
  const actor = {
    organizationId: input.organizationId,
    userId: input.userId,
    role,
  };
  const [workspaces, executions] = await Promise.all([
    listSandboxWorkspaces({ actor }),
    listSandboxExecutions({ actor, limit: 12 }),
  ]);
  const items = [
    ...workspaces.slice(0, 8).map((workspace, index) => [
      `مساحة ${index + 1}: ${workspace.name}`,
      `الحالة: ${workspace.status}`,
      `القالب: ${workspace.template}`,
      `المزود: ${workspace.provider}`,
      `الشبكة: ${workspace.networkMode}`,
      `آخر نشاط: ${workspace.lastActivityAt.toLocaleString("ar-SA")}`,
      `الخطأ: ${workspace.errorCode ?? "لا يوجد"}`,
    ].join("\n")),
    ...executions.slice(0, 12).map((execution, index) => [
      `تنفيذ ${index + 1}: ${execution.commandSummary}`,
      `الحالة: ${execution.status}`,
      `المخاطر: ${execution.riskLevel}`,
      `سياسة التنفيذ: ${typeof execution.policyDecision === "object" && execution.policyDecision && "outcome" in execution.policyDecision ? String(execution.policyDecision.outcome) : "غير متاحة"}`,
      `رمز الخروج: ${execution.exitCode ?? "لم يكتمل"}`,
      `المخرجات: stdout ${execution.stdoutBytes} بايت، stderr ${execution.stderrBytes} بايت`,
      `الخطأ: ${execution.errorCode ?? "لا يوجد"}`,
      `أضيف: ${execution.createdAt.toLocaleString("ar-SA")}`,
    ].join("\n")),
  ];
  if (!items.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا توجد مساحات أو عمليات Sandbox متاحة لحسابك.",
      action: "أنشئ مساحة من صفحة Sandbox داخل محادثة حقيقية ثم أعد الفحص.",
      buttonRows: [[{ url: "https://moatazalalqami.online/dashboard/sandbox", title: "فتح Sandbox" }], [{ id: "nav:home", title: "الرئيسية" }]],
    });
    return;
  }
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: `الرئيسية ← التشغيل ← Sandbox\nالمساحات: ${workspaces.length} — التنفيذات المعروضة: ${Math.min(executions.length, 12)}`,
    items,
    emptyText: "لا توجد بيانات تشغيل.",
    buttonRows: [[{ id: "sandbox:list", title: "تحديث" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}
