import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { telegramUserSessions } from "@/db/telegram-runtime-schema";
import { whatsappUserSessions } from "@/db/whatsapp-runtime-schema";
import { ApiError } from "@/lib/http/api";

export type ChannelClientKind = "telegram" | "whatsapp";
export type ChannelSessionState = Record<string, unknown>;
type TelegramUserSession = typeof telegramUserSessions.$inferSelect;
type WhatsAppUserSession = typeof whatsappUserSessions.$inferSelect;
export type ChannelClientSession =
  | ({ channel: "telegram" } & TelegramUserSession)
  | ({ channel: "whatsapp" } & WhatsAppUserSession);

export type ChannelSessionPatch = {
  organizationId?: string;
  activeFlow?: string | null;
  currentStep?: string | null;
  selectedAgentId?: string | null;
  selectedTeamId?: string | null;
  selectedConversationId?: string | null;
  state?: ChannelSessionState;
  expiresAt?: Date | null;
};

const FLOW_TTL_MS = 30 * 60_000;

function withChannel(channel: "telegram", row: TelegramUserSession): ChannelClientSession;
function withChannel(channel: "whatsapp", row: WhatsAppUserSession): ChannelClientSession;
function withChannel(channel: ChannelClientKind, row: TelegramUserSession | WhatsAppUserSession): ChannelClientSession {
  return { ...row, channel } as ChannelClientSession;
}

export async function ensureChannelClientSession(input: {
  channel: ChannelClientKind;
  userId: string;
  organizationId: string;
  externalUserId: string;
  externalChatId: string;
}) {
  if (input.channel === "telegram") {
    const [row] = await db().insert(telegramUserSessions).values({
      userId: input.userId,
      organizationId: input.organizationId,
      telegramUserId: input.externalUserId,
      telegramChatId: input.externalChatId,
    }).onConflictDoUpdate({
      target: telegramUserSessions.telegramUserId,
      set: {
        userId: input.userId,
        organizationId: input.organizationId,
        telegramChatId: input.externalChatId,
        updatedAt: new Date(),
      },
    }).returning();
    if (!row) throw new Error("TELEGRAM_SESSION_CREATE_FAILED");
    return expireFlowIfNeeded(withChannel("telegram", row));
  }

  const [row] = await db().insert(whatsappUserSessions).values({
    userId: input.userId,
    organizationId: input.organizationId,
    whatsappWaId: input.externalUserId,
    whatsappChatId: input.externalChatId,
  }).onConflictDoUpdate({
    target: whatsappUserSessions.whatsappWaId,
    set: {
      userId: input.userId,
      organizationId: input.organizationId,
      whatsappChatId: input.externalChatId,
      updatedAt: new Date(),
    },
  }).returning();
  if (!row) throw new Error("WHATSAPP_SESSION_CREATE_FAILED");
  return expireFlowIfNeeded(withChannel("whatsapp", row));
}

async function expireFlowIfNeeded(session: ChannelClientSession): Promise<ChannelClientSession> {
  if (!session.activeFlow || !session.expiresAt || session.expiresAt.getTime() > Date.now()) return session;
  return updateChannelClientSession(session, {
    activeFlow: null,
    currentStep: null,
    state: {},
    expiresAt: null,
  });
}

export async function updateChannelClientSession(
  session: ChannelClientSession,
  patch: ChannelSessionPatch,
): Promise<ChannelClientSession> {
  if (session.channel === "telegram") {
    const [updated] = await db().update(telegramUserSessions).set({
      ...patch,
      version: sql`${telegramUserSessions.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(telegramUserSessions.id, session.id),
      eq(telegramUserSessions.version, session.version),
    )).returning();
    if (!updated) throw new ApiError(409, "CHANNEL_SESSION_CONFLICT", "تغيرت جلسة القناة. أعد المحاولة.");
    return withChannel("telegram", updated);
  }

  const [updated] = await db().update(whatsappUserSessions).set({
    ...patch,
    version: sql`${whatsappUserSessions.version} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(whatsappUserSessions.id, session.id),
    eq(whatsappUserSessions.version, session.version),
  )).returning();
  if (!updated) throw new ApiError(409, "CHANNEL_SESSION_CONFLICT", "تغيرت جلسة القناة. أعد المحاولة.");
  return withChannel("whatsapp", updated);
}

export function startChannelFlow(
  session: ChannelClientSession,
  flow: string,
  step: string,
  state: ChannelSessionState = {},
) {
  return updateChannelClientSession(session, {
    activeFlow: flow,
    currentStep: step,
    state,
    expiresAt: new Date(Date.now() + FLOW_TTL_MS),
  });
}

export function advanceChannelFlow(
  session: ChannelClientSession,
  step: string,
  state: ChannelSessionState,
) {
  return updateChannelClientSession(session, {
    currentStep: step,
    state,
    expiresAt: new Date(Date.now() + FLOW_TTL_MS),
  });
}

export function finishChannelFlow(session: ChannelClientSession, patch: ChannelSessionPatch = {}) {
  return updateChannelClientSession(session, {
    ...patch,
    activeFlow: null,
    currentStep: null,
    state: {},
    expiresAt: null,
  });
}

export function selectChannelAgent(session: ChannelClientSession, agentId: string) {
  return updateChannelClientSession(session, {
    selectedAgentId: agentId,
    selectedConversationId: null,
  });
}
