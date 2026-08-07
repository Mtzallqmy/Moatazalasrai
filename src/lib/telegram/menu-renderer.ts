import type { TelegramInlineButton } from "@/lib/integrations/telegram";
import { resolveTelegramCapabilities } from "./capability-registry";
import { sendTelegramMenu } from "./message-renderer";

const ACTIONS: Record<string, string> = {
  "chat.start": "chat:start",
  "agents.list": "agents:list",
  "agents.create": "agents:create",
  "teams.list": "teams:page:1",
  "runs.list": "runs:page:1",
  "approvals.list": "approvals:list",
  "files.receive": "files:help",
  "repositories.list": "repositories:list",
  "site_connections.list": "connections:list",
  "mcp.list": "mcp:list",
  "browser.list": "browser:list",
  "sandbox.list": "sandbox:list",
  "account.status": "account:status",
};

export async function renderTelegramMainMenu(input: {
  token: string;
  chatId: string;
  userId: string;
  organizationId: string;
  title?: string;
}) {
  const capabilities = await resolveTelegramCapabilities({
    userId: input.userId,
    organizationId: input.organizationId,
  });
  const groups = [
    { title: "العمل الذكي", ids: ["chat.start", "agents.list", "agents.create", "teams.list", "runs.list"] },
    { title: "المحتوى والمعرفة", ids: ["files.receive"] },
    { title: "القنوات والتكاملات", ids: ["repositories.list", "site_connections.list", "mcp.list"] },
    { title: "التشغيل", ids: ["approvals.list", "browser.list", "sandbox.list"] },
    { title: "الحساب", ids: ["account.status"] },
  ];
  const rows: TelegramInlineButton[][] = [];
  const sectionNames: string[] = [];
  for (const group of groups) {
    const entries = capabilities.filter((capability) => group.ids.includes(capability.id));
    if (!entries.length) continue;
    sectionNames.push(group.title);
    for (let index = 0; index < entries.length; index += 2) {
      rows.push(entries.slice(index, index + 2).map((capability) => ({
        id: ACTIONS[capability.id],
        title: `${capability.icon ?? ""} ${capability.labelAr}`.trim(),
      })));
    }
  }
  if (!rows.length) rows.push([{ id: "account:status", title: "حالة الحساب" }]);
  await sendTelegramMenu({
    token: input.token,
    chatId: input.chatId,
    title: input.title ?? `الرئيسية${sectionNames.length ? `\nالأقسام المتاحة: ${sectionNames.join("، ")}` : ""}`,
    buttonRows: rows,
  });
}
