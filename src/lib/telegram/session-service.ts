import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { telegramUserSessions } from "@/db/telegram-runtime-schema";
import { ApiError } from "@/lib/http/api";

const DEFAULT_SESSION_TTL_MS = 30 * 60_000;

export type TelegramFlow =
  | "agent.create"
  | "agent.select"
  | "conversation.start"
  | "team.run"
  | "account.unlink";

export type TelegramSessionState = Record<string, unknown>;

export async function getTelegramSession(telegramUserId: string) {
  const [session] = await db().select().from(telegramUserSessions).where(and(
    eq(telegramUserSessions.telegramUserId, telegramUserId),
    or(isNull(telegramUserSessions.expiresAt), gt(telegramUserSessions.expiresAt, new Date())),
  )).limit(1);
  return session ?? null;
}

export async function ensureTelegramSession(input: {
  userId: string;
  organizationId: string;
  telegramUserId: string;
  telegramChatId: string;
}) {
  const [session] = await db().insert(telegramUserSessions).values({
    ...input,
    state: {},
  }).onConflictDoUpdate({
    target: telegramUserSessions.telegramUserId,
    set: {
      userId: input.userId,
      organizationId: input.organizationId,
      telegramChatId: input.telegramChatId,
      updatedAt: new Date(),
    },
  }).returning();
  if (!session) throw new Error("TELEGRAM_SESSION_CREATE_FAILED");
  return session;
}

export async function beginTelegramFlow(input: {
  telegramUserId: string;
  flow: TelegramFlow;
  step: string;
  state?: TelegramSessionState;
  selectedTeamId?: string | null;
  expiresInMs?: number;
}) {
  const [session] = await db().update(telegramUserSessions).set({
    activeFlow: input.flow,
    currentStep: input.step,
    state: input.state ?? {},
    ...(input.selectedTeamId === undefined ? {} : { selectedTeamId: input.selectedTeamId }),
    expiresAt: new Date(Date.now() + (input.expiresInMs ?? DEFAULT_SESSION_TTL_MS)),
    version: sql`${telegramUserSessions.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(telegramUserSessions.telegramUserId, input.telegramUserId)).returning();
  if (!session) throw new ApiError(409, "TELEGRAM_SESSION_NOT_FOUND", "جلسة Telegram غير موجودة. أعد فتح القائمة.");
  return session;
}

export async function advanceTelegramFlow(input: {
  sessionId: string;
  expectedVersion: number;
  step: string;
  state: TelegramSessionState;
  expiresInMs?: number;
}) {
  const [session] = await db().update(telegramUserSessions).set({
    currentStep: input.step,
    state: input.state,
    expiresAt: new Date(Date.now() + (input.expiresInMs ?? DEFAULT_SESSION_TTL_MS)),
    version: sql`${telegramUserSessions.version} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(telegramUserSessions.id, input.sessionId),
    eq(telegramUserSessions.version, input.expectedVersion),
  )).returning();
  if (!session) throw new ApiError(409, "TELEGRAM_SESSION_CONFLICT", "تغيرت العملية في طلب آخر. أعد المحاولة من آخر خطوة.");
  return session;
}

export async function selectTelegramAgent(input: {
  telegramUserId: string;
  agentId: string;
  conversationId?: string | null;
}) {
  const [session] = await db().update(telegramUserSessions).set({
    selectedAgentId: input.agentId,
    selectedConversationId: input.conversationId ?? null,
    activeFlow: null,
    currentStep: null,
    state: {},
    expiresAt: null,
    version: sql`${telegramUserSessions.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(telegramUserSessions.telegramUserId, input.telegramUserId)).returning();
  if (!session) throw new ApiError(409, "TELEGRAM_SESSION_NOT_FOUND", "جلسة Telegram غير موجودة.");
  return session;
}

export async function setTelegramConversation(input: {
  telegramUserId: string;
  conversationId: string;
  agentId: string;
}) {
  const [session] = await db().update(telegramUserSessions).set({
    selectedAgentId: input.agentId,
    selectedConversationId: input.conversationId,
    activeFlow: null,
    currentStep: null,
    state: {},
    expiresAt: null,
    version: sql`${telegramUserSessions.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(telegramUserSessions.telegramUserId, input.telegramUserId)).returning();
  if (!session) throw new ApiError(409, "TELEGRAM_SESSION_NOT_FOUND", "جلسة Telegram غير موجودة.");
  return session;
}

export async function cancelTelegramFlow(telegramUserId: string) {
  const [session] = await db().update(telegramUserSessions).set({
    activeFlow: null,
    currentStep: null,
    state: {},
    expiresAt: null,
    version: sql`${telegramUserSessions.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(telegramUserSessions.telegramUserId, telegramUserId)).returning();
  return session ?? null;
}
