import { cancelTelegramFlow } from "@/lib/telegram/session-service";
import { confirmUnlink, renderAccount } from "@/lib/telegram/account-flows";
import { renderAgents } from "@/lib/telegram/agent-flows";
import { openConversation } from "@/lib/telegram/conversation-flows";
import { renderFiles } from "@/lib/telegram/file-flows";
import { renderTelegramHelp, renderTelegramHome } from "@/lib/telegram/menu-renderer";
import { sendTelegramMenu } from "@/lib/telegram/message-renderer";
import type { TelegramActionContext } from "@/lib/telegram/types";
import { telegramCommand } from "@/lib/telegram/update-parser";

export async function routeTelegramCommand(context: TelegramActionContext) {
  const command = telegramCommand(context.update.text);
  if (!command) return false;
  if (command.name === "start") {
    await renderTelegramHome(context);
    return true;
  }
  if (command.name === "help") {
    await renderTelegramHelp(context);
    return true;
  }
  if (command.name === "status") {
    await renderAccount(context);
    return true;
  }
  if (command.name === "agents") {
    context.page = 1;
    await renderAgents(context);
    return true;
  }
  if (command.name === "new") {
    await openConversation(context);
    return true;
  }
  if (command.name === "files") {
    context.page = 1;
    await renderFiles(context);
    return true;
  }
  if (command.name === "unlink") {
    await confirmUnlink(context);
    return true;
  }
  if (command.name === "cancel") {
    if (!context.session.activeFlow) {
      await sendTelegramMenu({
        chatId: context.update.chatId,
        title: "لا توجد عملية نشطة",
        description: "لم يتم تغيير الوكيل أو المحادثة المحفوظة.",
        buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
      });
      return true;
    }
    const cancelled = context.session.activeFlow;
    context.session = await cancelTelegramFlow(context.session);
    await sendTelegramMenu({
      chatId: context.update.chatId,
      title: "تم إلغاء العملية الحالية",
      description: `العملية الملغاة: ${cancelled}. تم الإلغاء لأنك استخدمت /cancel صراحةً.`,
      buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
    });
    return true;
  }
  await sendTelegramMenu({
    chatId: context.update.chatId,
    title: "الأمر غير مدعوم",
    description: "هذا الأمر غير مسجل ضمن القدرات المكتملة. استخدم /help لعرض الأوامر الفعلية.",
    buttonRows: [[{ id: "nav:home", title: "الرئيسية" }]],
  });
  return true;
}
