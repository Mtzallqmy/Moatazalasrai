import type { ChannelIncomingMessage } from "@/lib/channels/types";
import type { ChannelClientKind, ChannelClientSession } from "./session-service";

export type ChannelFeatureRequirement = {
  key: string;
  labelAr: string;
};

function command(text: string) {
  return text.trim().toLocaleLowerCase("en-US").replace(/@\w+$/, "");
}

export function requiredChannelFeatures(input: {
  channel: ChannelClientKind;
  session: ChannelClientSession;
  incoming: ChannelIncomingMessage;
  actionId?: string | null;
  text: string;
}): ChannelFeatureRequirement[] {
  const prefix = input.channel;
  const requirements = new Map<string, string>();
  const add = (suffix: string, labelAr: string) => requirements.set(`${prefix}.${suffix}`, labelAr);

  for (const attachment of input.incoming.attachments) {
    if (attachment.kind === "image") add("images", "الصور");
    else if (attachment.kind === "audio") add("audio", "الصوت");
    else if (attachment.kind === "video") add("video", "الفيديو");
    else add("files", "الملفات");
  }

  const action = input.actionId ?? "";
  const normalized = command(input.text);
  const creatingAgent = input.session.activeFlow === "agent.create"
    || action === "cc.agent.create"
    || action.startsWith("cc.p:")
    || action.startsWith("cc.m:")
    || action.startsWith("cc.providers:")
    || action.startsWith("cc.models:")
    || action.startsWith("cc.publish:")
    || action === "cc.agent.confirm";
  if (creatingAgent) add("admin_commands", "إنشاء وإدارة الوكلاء");

  const listingAgents = action.startsWith("cc.agents:")
    || normalized === "/agents"
    || normalized === "الوكلاء";
  if (listingAgents) add("agents", "الوكلاء");

  const teamOperations = input.session.activeFlow === "team.run"
    || action.startsWith("cc.teams:")
    || action.startsWith("cc.team:")
    || action.startsWith("cc.runs:")
    || action.startsWith("cc.run:")
    || ["/teams", "/runs", "الفرق", "فرق الوكلاء", "التشغيلات", "عمليات التشغيل"].includes(normalized);
  if (teamOperations) add("agents", "فرق الوكلاء وعمليات التشغيل");

  const administrativeOperations = action.startsWith("cc.approval")
    || action === "cc.approvals"
    || action === "cc.repos"
    || action.startsWith("cc.repo:")
    || action === "cc.connections"
    || action.startsWith("cc.connection:")
    || action === "cc.mcp"
    || action.startsWith("cc.mcp:")
    || action === "cc.browser"
    || action === "cc.sandbox"
    || [
      "/approvals", "/github", "/repos", "/repositories", "/connections", "/sites", "/mcp", "/browser", "/sandbox",
      "الموافقات", "github", "جيت هب", "المستودعات", "مستودعات", "الاتصالات", "اتصالات المواقع", "الحسابات المتصلة",
      "mcp", "أدوات mcp", "خوادم mcp", "المتصفح", "ساندبوكس", "sandbox",
    ].includes(normalized);
  if (administrativeOperations) add("admin_commands", "التكاملات وأوامر التشغيل الإدارية");

  const opensFiles = action === "cc.files" || normalized === "/files" || normalized === "الملفات";
  if (opensFiles) add("files", "الملفات");

  const startsChat = action === "cc.chat"
    || action === "cc.chat.continue"
    || action.startsWith("cc.agent:")
    || normalized === "/new"
    || normalized === "محادثة"
    || normalized === "محادثة مباشرة";
  if (startsChat) {
    add("chat", "الدردشة");
    add("agents", "الوكلاء");
  }

  const knownNavigation = action.startsWith("cc.")
    || [
      "/start", "/help", "/status", "/agents", "/new", "/files", "/cancel", "/unlink",
      "/teams", "/runs", "/approvals", "/github", "/repos", "/repositories", "/connections", "/sites", "/mcp", "/browser", "/sandbox",
      "القائمة", "الرئيسية", "الحالة", "الوكلاء", "الملفات", "إلغاء", "الغاء",
      "الفرق", "فرق الوكلاء", "التشغيلات", "عمليات التشغيل", "الموافقات", "github", "جيت هب", "المستودعات", "مستودعات",
      "الاتصالات", "اتصالات المواقع", "الحسابات المتصلة", "mcp", "أدوات mcp", "خوادم mcp", "المتصفح", "ساندبوكس", "sandbox",
    ].includes(normalized);
  const ordinaryMessage = !knownNavigation
    && input.session.activeFlow !== "agent.create"
    && input.session.activeFlow !== "team.run"
    && (input.text.trim().length > 0 || input.incoming.attachments.length > 0);
  if (ordinaryMessage || input.session.activeFlow === "chat") add("chat", "الدردشة");
  if (ordinaryMessage && !input.session.selectedAgentId) add("agents", "الوكلاء");

  return [...requirements].map(([key, labelAr]) => ({ key, labelAr }));
}

export async function deniedChannelFeature(input: {
  requirements: ChannelFeatureRequirement[];
  featureAllowed(featureKey: string): Promise<boolean>;
}) {
  for (const requirement of input.requirements) {
    if (!await input.featureAllowed(requirement.key)) return requirement;
  }
  return null;
}
