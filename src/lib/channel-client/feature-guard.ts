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
    || ["/start", "/help", "/status", "/agents", "/new", "/files", "/cancel", "/unlink", "القائمة", "الرئيسية", "الحالة", "الوكلاء", "الملفات", "إلغاء", "الغاء"].includes(normalized);
  const ordinaryMessage = !knownNavigation
    && input.session.activeFlow !== "agent.create"
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
