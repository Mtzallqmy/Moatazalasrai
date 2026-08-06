import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers } from "@/db/schema";
import {
  telegramUserSessions,
  type TelegramSessionState,
  type TelegramUserSession,
} from "@/db/telegram-platform-schema";
import type { PlatformActor } from "@/lib/auth/actor-authorization";
import { ApiError } from "@/lib/http/api";

const FLOW_TTL_MS = 30 * 60_000;

function nextExpiry() {
  return new Date(Date.now() + FLOW_TTL_MS);
}

export async function actorForTelegramSession(session: TelegramUserSession): Promise<PlatformActor> {
  const [membership] = await db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, session.organizationId),
    eq(organizationMembers.userId, session.userId),
  )).limit(1);
  if (!membership) throw new ApiError(403, "ORGANIZATION_MEMBERSHIP_REQUIRED", "لم تعد عضوًا في المؤسسة المحددة.");
  return { userId: session.userId, organizationId: session.organizationId, role: membership.role };
}

export async function getOrCreateTelegramSession(input: {
  userId: string;
  organizationId: string;
  telegramUserId: string;
  telegramChatId: string;
}) {
  const now = new Date();
  const [session] = await db().insert(telegramUserSessions).values({
    userId: input.userId,
    organizationId: input.organizationId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    state: {},
    expiresAt: nextExpiry(),
  }).onConflictDoUpdate({
    target: [telegramUserSessions.telegramUserId, telegramUserSessions.telegramChatId],
    set: {
      userId: input.userId,
      telegramChatId: input.telegramChatId,
      updatedAt: now,
    },
  }).returning();
  if (!session) throw new Error("TELEGRAM_SESSION_CREATE_FAILED");
  if (session.activeFlow && session.expiresAt <= now) {
    return updateTelegramSession(session, {
      activeFlow: null,
      currentStep: null,
      state: {},
      expiresAt: nextExpiry(),
    });
  }
  return session;
}

export type TelegramSessionPatch = Partial<Pick<TelegramUserSession,
  | "organizationId"
  | "activeFlow"
  | "currentStep"
  | "selectedAgentId"
  | "selectedTeamId"
  | "selectedConversationId"
  | "state"
  | "expiresAt"
>>;

export async function updateTelegramSession(
  current: TelegramUserSession,
  patch: TelegramSessionPatch,
) {
  const [updated] = await db().update(telegramUserSessions).set({
    ...patch,
    version: current.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(telegramUserSessions.id, current.id),
    eq(telegramUserSessions.version, current.version),
  )).returning();
  if (!updated) {
    throw new ApiError(409, "TELEGRAM_SESSION_CONFLICT", "تغيرت حالة الجلسة. أعد المحاولة من القائمة الحالية.");
  }
  return updated;
}

export function beginTelegramFlow(
  session: TelegramUserSession,
  input: { flow: string; step: string; state?: TelegramSessionState },
) {
  return updateTelegramSession(session, {
    activeFlow: input.flow,
    currentStep: input.step,
    state: input.state ?? {},
    expiresAt: nextExpiry(),
  });
}

export function advanceTelegramFlow(
  session: TelegramUserSession,
  input: { step: string; state: TelegramSessionState },
) {
  if (!session.activeFlow) throw new ApiError(409, "TELEGRAM_FLOW_MISSING", "لا توجد عملية نشطة.");
  if (session.expiresAt <= new Date()) throw new ApiError(409, "TELEGRAM_FLOW_EXPIRED", "انتهت صلاحية العملية الحالية.");
  return updateTelegramSession(session, {
    currentStep: input.step,
    state: input.state,
    expiresAt: nextExpiry(),
  });
}

export function cancelTelegramFlow(session: TelegramUserSession) {
  if (!session.activeFlow) return Promise.resolve(session);
  return updateTelegramSession(session, {
    activeFlow: null,
    currentStep: null,
    state: {},
    expiresAt: nextExpiry(),
  });
}

export function completeTelegramFlow(
  session: TelegramUserSession,
  patch: Omit<TelegramSessionPatch, "activeFlow" | "currentStep" | "state"> = {},
) {
  return updateTelegramSession(session, {
    ...patch,
    activeFlow: null,
    currentStep: null,
    state: {},
    expiresAt: nextExpiry(),
  });
}

export function selectTelegramOrganization(session: TelegramUserSession, organizationId: string) {
  return updateTelegramSession(session, {
    organizationId,
    activeFlow: null,
    currentStep: null,
    selectedAgentId: null,
    selectedTeamId: null,
    selectedConversationId: null,
    state: {},
    expiresAt: nextExpiry(),
  });
}
