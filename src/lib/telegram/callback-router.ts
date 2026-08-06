import { ApiError } from "@/lib/http/api";
import { visibleTelegramCapabilities } from "@/lib/telegram/capability-registry";
import {
  chooseOrganization,
  confirmUnlink,
  executeUnlink,
  renderAccount,
  renderOrganizations,
} from "@/lib/telegram/account-flows";
import {
  handleAgentCreationCallback,
  renderAgentDetails,
  selectAgentForTelegram,
  startAgentCreation,
} from "@/lib/telegram/agent-flows";
import {
  confirmApprovalDecision,
  decideApproval,
  renderApprovalDetails,
} from "@/lib/telegram/approval-flows";
import {
  openConversation,
  resumeConversation,
  startNewConversation,
  stopConversationMode,
} from "@/lib/telegram/conversation-flows";
import { renderTelegramHome, renderTelegramSection } from "@/lib/telegram/menu-renderer";
import { sendTelegramMenu } from "@/lib/telegram/message-renderer";
import { markNotificationsRead } from "@/lib/telegram/platform-flows";
import { cancelTelegramFlow } from "@/lib/telegram/session-service";
import {
  confirmTeamRun,
  mutateTeamRun,
  renderRunDetails,
  renderTeamDetails,
  startTeamRun,
} from "@/lib/telegram/team-flows";
import type { TelegramActionContext } from "@/lib/telegram/types";

function callbackMessageId(context: TelegramActionContext) {
  return context.update.messageId;
}

async function confirmCancelFlow(context: TelegramActionContext) {
  if (!context.session.activeFlow) return renderTelegramHome(context);
  return sendTelegramMenu({
    chatId: context.update.chatId,
    messageId: callbackMessageId(context),
    path: "الرئيسية ← العملية النشطة ← إلغاء",
    title: "تأكيد إلغاء العملية",
    description: `العملية: ${context.session.activeFlow}\nالخطوة: ${context.session.currentStep ?? "غير محددة"}\nلن تُحذف اختيارات الوكيل أو المحادثة المحفوظة.`,
    buttonRows: [[{ id: "flow:cancel", title: "تأكيد الإلغاء" }], [{ id: "flow:resume", title: "متابعة العملية" }]],
  });
}

async function resumeActiveFlow(context: TelegramActionContext) {
  const flow = context.session.activeFlow;
  const step = context.session.currentStep;
  if (!flow) return renderTelegramHome(context);
  if (flow === "conversation.chat") return resumeConversation(context);
  if (flow === "agent.create") {
    const state = context.session.state as Record<string, unknown>;
    if (step === "provider") {
      const providers = Array.isArray(state.providers)
        ? state.providers.filter((value): value is { name: string } => Boolean(value && typeof value === "object" && "name" in value))
        : [];
      return sendTelegramMenu({
        chatId: context.update.chatId,
        messageId: callbackMessageId(context),
        path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
        title: "متابعة اختيار المزود",
        description: "اختر المزود المحفوظ في العملية الحالية.",
        buttonRows: [...providers.map((provider, index) => [{ id: `acf:p:${index}`, title: String(provider.name).slice(0, 55) }]), [{ id: "flow:cancel", title: "إلغاء" }]],
      });
    }
    if (step === "model") {
      const models = Array.isArray(state.models) ? state.models.filter((value): value is string => typeof value === "string") : [];
      return sendTelegramMenu({
        chatId: context.update.chatId,
        messageId: callbackMessageId(context),
        path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
        title: "متابعة اختيار النموذج",
        description: `المزود: ${String(state.providerName ?? "المزود المختار")}`,
        buttonRows: [...models.map((model, index) => [{ id: `acf:m:${index}`, title: model.slice(0, 55) }]), [{ id: "flow:cancel", title: "إلغاء" }]],
      });
    }
    if (step === "status") {
      return sendTelegramMenu({
        chatId: context.update.chatId,
        messageId: callbackMessageId(context),
        path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
        title: "متابعة تحديد حالة الوكيل",
        description: "اختر مسودة أو نشر.",
        buttonRows: [[{ id: "acf:s:d", title: "حفظ كمسودة" }, { id: "acf:s:p", title: "إنشاء ونشر" }], [{ id: "flow:cancel", title: "إلغاء" }]],
      });
    }
    if (step === "confirm") {
      return sendTelegramMenu({
        chatId: context.update.chatId,
        messageId: callbackMessageId(context),
        path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
        title: "متابعة تأكيد إنشاء الوكيل",
        description: `الاسم: ${String(state.name)}\nالمزود: ${String(state.providerName)}\nالنموذج: ${String(state.model)}\nالحالة: ${state.publish ? "منشور" : "مسودة"}`,
        buttonRows: [[{ id: "acf:ok", title: "تأكيد الإنشاء" }], [{ id: "flow:cancel", title: "إلغاء" }]],
      });
    }
    const prompts: Record<string, string> = {
      name: "أرسل اسم الوكيل.",
      description: "أرسل وصف الوكيل أو علامة - للتخطي.",
      instructions: "أرسل التعليمات الأساسية للوكيل.",
    };
    return sendTelegramMenu({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      path: "الرئيسية ← الوكلاء ← إنشاء وكيل",
      title: "متابعة إنشاء الوكيل",
      description: prompts[step ?? ""] ?? "تعذر تحديد الخطوة الحالية.",
      buttonRows: [[{ id: "flow:cancel", title: "إلغاء" }]],
    });
  }
  if (flow === "team.run") {
    const prompt = typeof context.session.state.prompt === "string" ? context.session.state.prompt : "";
    return sendTelegramMenu({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      path: "الرئيسية ← فرق الوكلاء ← تشغيل الفريق",
      title: step === "confirm" ? "متابعة تأكيد التشغيل" : "متابعة إدخال مهمة الفريق",
      description: step === "confirm" ? prompt : "أرسل نص المهمة التي سينفذها الفريق.",
      buttonRows: step === "confirm"
        ? [[{ id: "team:run:confirm", title: "تأكيد التشغيل" }], [{ id: "flow:cancel", title: "إلغاء" }]]
        : [[{ id: "flow:cancel", title: "إلغاء" }]],
    });
  }
  throw new ApiError(409, "TELEGRAM_FLOW_STEP_INVALID", "لا يوجد معالج مكتمل للعملية النشطة.");
}

export async function routeTelegramCallback(context: TelegramActionContext) {
  const action = context.update.callbackData?.trim();
  if (!action) throw new ApiError(400, "TELEGRAM_CALLBACK_INVALID", "إجراء Telegram غير صالح.");
  if (action === "nav:home") return renderTelegramHome(context);
  if (action.startsWith("sec:")) return renderTelegramSection(context, action.slice(4));
  const capabilityMatch = /^cap:([a-z.]+):(\d+)$/.exec(action);
  if (capabilityMatch) {
    const capabilityId = capabilityMatch[1]!;
    context.page = Math.max(1, Number(capabilityMatch[2]));
    const visible = await visibleTelegramCapabilities(context);
    const capability = visible.find((entry) => entry.id === capabilityId);
    if (!capability) throw new ApiError(403, "TELEGRAM_FEATURE_FORBIDDEN", "هذه القدرة غير متاحة لحسابك.");
    return capability.handler(context);
  }
  if (action === "agt:c") return startAgentCreation(context);
  if (action.startsWith("agt:v:")) return renderAgentDetails(context, action.slice("agt:v:".length));
  if (action.startsWith("agt:s:")) return selectAgentForTelegram(context, action.slice("agt:s:".length));
  if (action.startsWith("acf:")) return handleAgentCreationCallback(context, action);
  if (action === "chat:open" || action === "chat:agents") return openConversation(context);
  if (action === "chat:new") return startNewConversation(context);
  if (action === "chat:resume") return resumeConversation(context);
  if (action === "chat:stop") return stopConversationMode(context);
  if (action.startsWith("team:v:")) return renderTeamDetails(context, action.slice("team:v:".length));
  if (action.startsWith("team:r:")) return startTeamRun(context, action.slice("team:r:".length));
  if (action === "team:run:confirm") return confirmTeamRun(context);
  if (action.startsWith("run:t:")) return renderRunDetails(context, action.slice("run:t:".length));
  if (action.startsWith("run:c:")) return mutateTeamRun(context, action.slice("run:c:".length), "cancel");
  if (action.startsWith("run:r:")) return mutateTeamRun(context, action.slice("run:r:".length), "retry");
  if (action.startsWith("ap:v:")) return renderApprovalDetails(context, action.slice("ap:v:".length));
  const approvalQuestion = /^ap:q:([0-9a-f-]{36}):(a|r)$/i.exec(action);
  if (approvalQuestion) return confirmApprovalDecision(context, approvalQuestion[1]!, approvalQuestion[2] === "a");
  const approvalDecision = /^ap:d:([0-9a-f-]{36}):(a|r)$/i.exec(action);
  if (approvalDecision) return decideApproval(context, approvalDecision[1]!, approvalDecision[2] === "a");
  if (action === "account:organizations") return renderOrganizations(context);
  if (action.startsWith("org:s:")) return chooseOrganization(context, action.slice("org:s:".length));
  if (action === "account:unlink") return confirmUnlink(context);
  if (action === "account:unlink:confirm") return executeUnlink(context);
  if (action === "notifications:read") return markNotificationsRead(context);
  if (action === "flow:resume") return resumeActiveFlow(context);
  if (action === "flow:cancel:confirm") return confirmCancelFlow(context);
  if (action === "flow:cancel") {
    context.session = await cancelTelegramFlow(context.session);
    return sendTelegramMenu({
      chatId: context.update.chatId,
      messageId: callbackMessageId(context),
      title: "تم إلغاء العملية الحالية",
      description: "تم الإلغاء بواسطة زر واضح. بقي اختيار الوكيل والمحادثة المحفوظة دون تغيير.",
      buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
    });
  }
  throw new ApiError(400, "TELEGRAM_CALLBACK_UNKNOWN", "هذا الإجراء غير مسجل أو لم يعد مدعومًا.");
}
