import {
  decideToolApproval,
  getToolApproval,
  listPendingToolApprovals,
} from "@/lib/ai-sdk/approvals";
import { ApiError } from "@/lib/http/api";
import {
  enqueueAgentRunResume,
  enqueueBrowserResume,
  enqueueSandboxResume,
} from "@/worker/queue";
import { assertTelegramCapability } from "./capability-registry";
import { sendTelegramEmptyState, sendTelegramList, sendTelegramMenu } from "./message-renderer";

type ApprovalContext = {
  token: string;
  chatId: string;
  userId: string;
  organizationId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function assertApprovalAccess(input: ApprovalContext) {
  const capability = await assertTelegramCapability({
    userId: input.userId,
    organizationId: input.organizationId,
    capabilityId: "approvals.list",
  });
  if (!capability) throw new ApiError(403, "TELEGRAM_CAPABILITY_DENIED", "مراجعة الموافقات غير متاحة لحسابك.");
}

export async function listTelegramApprovals(input: ApprovalContext) {
  await assertApprovalAccess(input);
  const approvals = await listPendingToolApprovals(input.organizationId);
  if (!approvals.length) {
    await sendTelegramEmptyState({
      token: input.token,
      chatId: input.chatId,
      reason: "لا توجد موافقات معلقة في المؤسسة.",
      action: "ستظهر هنا فقط طلبات الأدوات الحقيقية التي تنتظر قرارًا.",
      buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
    });
    return;
  }

  // Telegram accepts at most eight keyboard rows in this renderer. Keep one
  // row reserved for refresh/home navigation instead of silently dropping it.
  const visible = approvals.slice(0, 6);
  await sendTelegramList({
    token: input.token,
    chatId: input.chatId,
    title: `الموافقات المعلقة (${approvals.length})`,
    items: visible.map((approval, index) => [
      `${index + 1}. ${approval.toolName}`,
      `الوكيل: ${approval.agentName}`,
      `المصدر: ${approval.serverName}`,
      `المخاطر: ${approval.risk}`,
      `تنتهي: ${approval.expiresAt.toLocaleString("ar-SA")}`,
    ].join("\n")),
    emptyText: "لا توجد موافقات معلقة.",
    buttonRows: [
      ...visible.filter((approval) => UUID.test(approval.approvalId)).map((approval) => ([{
        id: `approval:view:${approval.approvalId}`,
        title: `مراجعة ${approval.toolName}`.slice(0, 55),
      }])),
      [{ id: "approvals:list", title: "تحديث" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function showTelegramApproval(input: ApprovalContext & { approvalId: string }) {
  await assertApprovalAccess(input);
  if (!UUID.test(input.approvalId)) throw new ApiError(422, "TOOL_APPROVAL_INVALID", "معرّف الموافقة غير صالح.");
  const approval = await getToolApproval(input.organizationId, input.approvalId);
  const summary = Object.entries(approval.argumentsSummary ?? {})
    .slice(0, 12)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
  const pending = approval.status === "pending" && approval.expiresAt > new Date();
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: [
      "الرئيسية ← التشغيل ← الموافقات",
      `الأداة: ${approval.toolName}`,
      `الوكيل: ${approval.agentName}`,
      `المصدر: ${approval.serverName}`,
      `المخاطر: ${approval.risk}`,
      `السبب: ${approval.reason || "لم يحدد"}`,
      `الحالة: ${approval.status}`,
      summary ? `المدخلات المنقحة:\n${summary}` : "لا توجد مدخلات قابلة للعرض.",
    ].join("\n\n"),
    buttonRows: pending
      ? [
          [{ id: `approval:confirm:${approval.approvalId}:approve`, title: "موافقة" }, { id: `approval:confirm:${approval.approvalId}:reject`, title: "رفض" }],
          [{ id: "approvals:list", title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }],
        ]
      : [[{ id: "approvals:list", title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}

export async function confirmTelegramApprovalDecision(input: ApprovalContext & {
  approvalId: string;
  decision: "approve" | "reject";
}) {
  await assertApprovalAccess(input);
  const approval = await getToolApproval(input.organizationId, input.approvalId);
  if (approval.status !== "pending") {
    throw new ApiError(409, "TOOL_APPROVAL_ALREADY_DECIDED", "اتُخذ قرار لهذه الموافقة مسبقًا.");
  }
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: `${input.decision === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}\n\nالأداة: ${approval.toolName}\nالوكيل: ${approval.agentName}\nالمخاطر: ${approval.risk}`,
    buttonRows: [
      [{ id: `approval:decide:${approval.approvalId}:${input.decision}`, title: input.decision === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض" }],
      [{ id: `approval:view:${approval.approvalId}`, title: "إلغاء" }],
    ],
  });
}

export async function decideTelegramApproval(input: ApprovalContext & {
  approvalId: string;
  decision: "approve" | "reject";
}) {
  await assertApprovalAccess(input);
  const result = await decideToolApproval({
    organizationId: input.organizationId,
    approvalId: input.approvalId,
    userId: input.userId,
    approved: input.decision === "approve",
    reason: input.decision === "approve" ? "Approved from Telegram" : "Rejected from Telegram",
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

  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: `${input.decision === "approve" ? "تمت الموافقة" : "تم الرفض"} بنجاح.\nتم إرسال قرار الموافقة إلى مسار الاستئناف الحقيقي.\nحالة الطلب: ${result.status}`,
    buttonRows: [[{ id: "approvals:list", title: "الموافقات" }, { id: "nav:home", title: "الرئيسية" }]],
  });
  return queued;
}
