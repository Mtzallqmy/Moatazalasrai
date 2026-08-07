import {
  CHANNEL_CAPABILITY_REGISTRY,
  resolveChannelCapabilities,
  type ChannelCapability,
} from "@/lib/channel-client/capability-registry";
import { telegramFeatureAllowed, type TelegramFeatureKey } from "@/lib/integrations/telegram-platform";

export type TelegramCapabilityId =
  | "chat.start"
  | "agents.list"
  | "agents.create"
  | "teams.list"
  | "teams.run"
  | "runs.list"
  | "approvals.list"
  | "files.receive"
  | "repositories.list"
  | "browser.list"
  | "sandbox.list"
  | "account.status";

export type TelegramCapability = ChannelCapability & { id: TelegramCapabilityId };

export const TELEGRAM_CAPABILITIES: readonly TelegramCapability[] = CHANNEL_CAPABILITY_REGISTRY
  .filter((capability): capability is ChannelCapability & { id: TelegramCapabilityId } => [
    "chat.start",
    "agents.list",
    "agents.create",
    "teams.list",
    "teams.run",
    "runs.list",
    "approvals.list",
    "files.receive",
    "repositories.list",
    "browser.list",
    "sandbox.list",
    "account.status",
  ].includes(capability.id));

export async function resolveTelegramCapabilities(input: {
  userId: string;
  organizationId: string;
}) {
  const visible = await resolveChannelCapabilities({
    identity: {
      channel: "telegram",
      userId: input.userId,
      organizationId: input.organizationId,
      externalUserId: "capability-check",
      externalChatId: "capability-check",
    },
    featureAllowed: async (featureKey) => telegramFeatureAllowed(
      input.userId,
      input.organizationId,
      featureKey as TelegramFeatureKey,
    ).then(Boolean),
  });
  return visible.filter((capability): capability is TelegramCapability =>
    TELEGRAM_CAPABILITIES.some((registered) => registered.id === capability.id));
}

export async function assertTelegramCapability(input: {
  userId: string;
  organizationId: string;
  capabilityId: TelegramCapabilityId;
}) {
  const visible = await resolveTelegramCapabilities(input);
  return visible.find((capability) => capability.id === input.capabilityId) ?? null;
}
