import type { TelegramUserSession } from "@/db/telegram-platform-schema";
import type { PlatformActor } from "@/lib/auth/actor-authorization";
import type { TelegramFeatureKey } from "@/lib/integrations/telegram-platform";
import type { ParsedTelegramUpdate } from "@/lib/telegram/update-parser";

export type TelegramLinkedAccount = {
  id: string;
  userId: string;
  organizationId: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  status: string;
  linkedAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TelegramActionContext = {
  update: ParsedTelegramUpdate;
  account: TelegramLinkedAccount;
  session: TelegramUserSession;
  actor: PlatformActor;
  page: number;
  dashboardUrl: string;
};

export type TelegramCapabilityFeature = TelegramFeatureKey;
