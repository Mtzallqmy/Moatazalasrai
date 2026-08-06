import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { toolApprovalsRuntime } from "@/db/agent-runtime-schema";
import {
  decideToolApproval,
  getToolApproval,
  listPendingToolApprovals,
} from "@/lib/ai-sdk/approvals";
import { ApiError } from "@/lib/http/api";
import { sendTelegramEmptyState, sendTelegramList, sendTelegramMenu } from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";
import { enqueueAgentRunResume, enqueueBrowserResume, enqueueSandboxResume } from "@/worker/queue";

function assertApprovalRole(context: TelegramActionContext) {
  if (!["owner", "admin", "developer", "operator"].includes(context.actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "لا تملك صلاحية مراجعة الموافقات.");
  }
}

function messageId(context: TelegramActionContext) {
  return context.update.kind === "callback_query" ? context.update.messageId : undefined;
}

export async function renderApprovals(context: TelegramActionContext) {
  assertApprovalRole(context);
  const allRows = await listPendingToolApprovals(context.actor.organizationId);
  if (!allRows.length) {
    return sendTelegramEmptyState({
      chatId: context.update.chatId,
      messageId: messageId(context),
      title: "الرئيسية ← التشغيل ← الموافقات",
      text: "لا توجد موافقات معلقة حاليًا.",
      buttonRows: [[{ id: "nav:home", title: "الرئيسية" }, { id: "cap:approvals.list:1", title: "تحديث" }]],
    });
  }
  const limit = 5;
  const pages = Math.max(1, Math.ceil(allRows.length / limit));
  const page = Math.min(Math.max(1, context.page), pages);
  const rows = allRows.slice((page - 1) * limit, page * limit);
  const pager = [] as Array<{ id: string; title: string }>;
  if (page > 1) pager.push({ id: `cap:approvals.list:${page - 1}`, title: "السابق" });
  if (page < pages) pager.push({ id: `cap:approvals.list:${page + 1}`, title: "التالي" });
  return sendTelegramList({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← التشغيل ← الموافقات",
    title: `الموافقات المعلقة الفعلية — صفحة ${page} من ${pages}`,
    items: rows.map((approval, index) => `${(page - 1) * limit + index + 1}. ${approval.toolName}\nالوكيل: ${approval.agentName}\nالمصدر: ${approval.serverName}\nالمخاطر: ${approval.risk ?? "غير محددة"}\nتنتهي: ${approval.expiresAt.toISOString()}`),
    buttonRows: [
      ...rows.map((approval) => [{ id: `ap:v:${approval.id}`, title: `${approval.toolName} — ${approval.risk ?? "موافقة"}`.slice(0, 60) }]),
      ...(pager.length ? [pager] : []),
      [{ id: "nav:home", title: "الرئيسية" }, { id: `cap:approvals.list:${page}`, title: "تحديث" }],
    ],
  });
}

async function approvalByRowId(context: TelegramActionContext, rowId: string) {
  assertApprovalRole(context);
  const [row] = await db().select({ approvalId: toolApprovalsRuntime.approvalId }).from(toolApprovalsRuntime).where(and(
    eq(toolApprovalsRuntime.id, rowId),
    eq(toolApprovalsRuntime.organizationId, context.actor.organizationId),
  )).limit(1);
  if (!row) throw new ApiError(404, "TOOL_APPROVAL_NOT_FOUND", "طلب الموافقة غير موجود.");
  return getToolApproval(context.actor.organizationId, row.approvalId);
}

export async function renderApprovalDetails(context: TelegramActionContext, rowId: string) {
  const approval = await approvalByRowId(context, rowId);
  const argumentsText = Object.entries(approval.argumentsSummary ?? {})
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n") || "لا توجد معاملات قابلة للعرض.";
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← التشغيل ← الموافقات ← التفاصيل",
    title: approval.toolName,
    description: [
      `الوكيل: ${approval.agentName}`,
      `المصدر: ${approval.serverName}`,
      `المخاطر: ${approval.risk ?? "غير محددة"}`,
      `السبب: ${approval.reason ?? "لم يحدد سبب"}`,
      `الحالة: ${approval.status}`,
      `تنتهي: ${approval.expiresAt.toISOString()}`,
      "",
      "ملخص المعاملات المنقح:",
      argumentsText,
    ].join("\n"),
    buttonRows: [
      [{ id: `ap:q:${rowId}:a`, title: "موافقة" }, { id: `ap:q:${rowId}:r`, title: "رفض" }],
      [{ id: "cap:approvals.list:1", title: "رجوع" }, { id: "nav:home", title: "الرئيسية" }],
    ],
  });
}

export async function confirmApprovalDecision(context: TelegramActionContext, rowId: string, approved: boolean) {
  const approval = await approvalByRowId(context, rowId);
  if (approval.status !== "pending") throw new ApiError(409, "TOOL_APPROVAL_ALREADY_DECIDED", "تمت معالجة الموافقة مسبقًا.");
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← التشغيل ← الموافقات ← تأكيد القرار",
    title: approved ? "تأكيد الموافقة" : "تأكيد الرفض",
    description: `${approved ? "لن تُنفذ الأداة إلا بعد حفظ قرار الموافقة واستئناف التشغيل." : "سيُحفظ الرفض ولن تُنفذ الأداة."}\n\nالأداة: ${approval.toolName}\nالمخاطر: ${approval.risk ?? "غير محددة"}`,
    buttonRows: [[{ id: `ap:d:${rowId}:${approved ? "a" : "r"}`, title: approved ? "تأكيد الموافقة" : "تأكيد الرفض" }], [{ id: `ap:v:${rowId}`, title: "إلغاء" }]],
  });
}

export async function decideApproval(context: TelegramActionContext, rowId: string, approved: boolean) {
  const current = await approvalByRowId(context, rowId);
  const result = await decideToolApproval({
    organizationId: context.actor.organizationId,
    approvalId: current.approvalId,
    userId: context.actor.userId,
    approved,
    reason: approved ? "Approved from central Telegram client" : "Rejected from central Telegram client",
  });
  const queued = result.sandboxExecutionId
    ? await enqueueSandboxResume({
        organizationId: context.actor.organizationId,
        approvalId: result.approvalId,
        executionId: result.sandboxExecutionId,
      })
    : result.browserTaskId
      ? await enqueueBrowserResume({
          organizationId: context.actor.organizationId,
          approvalId: result.approvalId,
          browserTaskId: result.browserTaskId,
        })
      : await enqueueAgentRunResume({
          organizationId: context.actor.organizationId,
          approvalId: result.approvalId,
        });
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: messageId(context),
    path: "الرئيسية ← التشغيل ← الموافقات ← النتيجة",
    title: approved ? "تم حفظ الموافقة" : "تم حفظ الرفض",
    description: `الحالة الجديدة: ${result.status}\nتم إنشاء مهمة استئناف فعلية: ${queued.jobId}\nلن يُعالج القرار مرة ثانية.`,
    buttonRows: [[{ id: "cap:approvals.list:1", title: "الموافقات المعلقة" }, { id: "nav:home", title: "الرئيسية" }]],
  });
}
