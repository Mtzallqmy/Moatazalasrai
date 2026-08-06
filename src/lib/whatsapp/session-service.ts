import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { whatsappUserSessions } from "@/db/whatsapp-platform-schema";
import { ApiError } from "@/lib/http/api";

const SESSION_TTL_MS = 30 * 60_000;

export type WhatsAppFlow =
  | "agent.create"
  | "agent.select"
  | "conversation.start"
  | "account.disconnect";

export type WhatsAppSession = typeof whatsappUserSessions.$inferSelect;

function expiresAt() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

function stateObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function getOrCreateWhatsAppSession(input: {
  userId: string;
  organizationId: string;
  waId: string;
}): Promise<WhatsAppSession> {
  const [session] = await db().insert(whatsappUserSessions).values({
    userId: input.userId,
    organizationId: input.organizationId,
    whatsappWaId: input.waId,
    state: {},
    expiresAt: expiresAt(),
  }).onConflictDoUpdate({
    target: [
      whatsappUserSessions.userId,
      whatsappUserSessions.organizationId,
      whatsappUserSessions.whatsappWaId,
    ],
    set: { updatedAt: new Date() },
  }).returning();
  if (!session) throw new Error("WHATSAPP_SESSION_CREATE_FAILED");
  if (session.expiresAt > new Date()) return session;
  return resetExpiredWhatsAppSession(session);
}

async function resetExpiredWhatsAppSession(session: WhatsAppSession): Promise<WhatsAppSession> {
  const [reset] = await db().update(whatsappUserSessions).set({
    activeFlow: null,
    currentStep: null,
    state: {},
    version: sql`${whatsappUserSessions.version} + 1`,
    expiresAt: expiresAt(),
    updatedAt: new Date(),
  }).where(and(
    eq(whatsappUserSessions.id, session.id),
    eq(whatsappUserSessions.version, session.version),
  )).returning();
  if (reset) return reset;
  return getOrCreateWhatsAppSession({
    userId: session.userId,
    organizationId: session.organizationId,
    waId: session.whatsappWaId,
  });
}

export async function updateWhatsAppSession(input: {
  session: WhatsAppSession;
  activeFlow?: WhatsAppFlow | null;
  currentStep?: string | null;
  selectedAgentId?: string | null;
  selectedTeamId?: string | null;
  selectedConversationId?: string | null;
  state?: Record<string, unknown>;
  extend?: boolean;
}): Promise<WhatsAppSession> {
  const [updated] = await db().update(whatsappUserSessions).set({
    ...(input.activeFlow === undefined ? {} : { activeFlow: input.activeFlow }),
    ...(input.currentStep === undefined ? {} : { currentStep: input.currentStep }),
    ...(input.selectedAgentId === undefined ? {} : { selectedAgentId: input.selectedAgentId }),
    ...(input.selectedTeamId === undefined ? {} : { selectedTeamId: input.selectedTeamId }),
    ...(input.selectedConversationId === undefined ? {} : { selectedConversationId: input.selectedConversationId }),
    ...(input.state === undefined ? {} : { state: input.state }),
    version: sql`${whatsappUserSessions.version} + 1`,
    ...(input.extend === false ? {} : { expiresAt: expiresAt() }),
    updatedAt: new Date(),
  }).where(and(
    eq(whatsappUserSessions.id, input.session.id),
    eq(whatsappUserSessions.version, input.session.version),
  )).returning();
  if (!updated) {
    throw new ApiError(409, "WHATSAPP_SESSION_CONFLICT", "تغيرت حالة العملية. أعد فتح القائمة ثم حاول مرة أخرى.");
  }
  return updated;
}

export function startWhatsAppFlow(input: {
  session: WhatsAppSession;
  flow: WhatsAppFlow;
  step: string;
  state?: Record<string, unknown>;
}) {
  return updateWhatsAppSession({
    session: input.session,
    activeFlow: input.flow,
    currentStep: input.step,
    state: input.state ?? {},
  });
}

export function advanceWhatsAppFlow(input: {
  session: WhatsAppSession;
  step: string;
  patch?: Record<string, unknown>;
}) {
  return updateWhatsAppSession({
    session: input.session,
    currentStep: input.step,
    state: { ...stateObject(input.session.state), ...(input.patch ?? {}) },
  });
}

export function finishWhatsAppFlow(input: {
  session: WhatsAppSession;
  selectedAgentId?: string | null;
  selectedConversationId?: string | null;
}) {
  return updateWhatsAppSession({
    session: input.session,
    activeFlow: null,
    currentStep: null,
    state: {},
    selectedAgentId: input.selectedAgentId,
    selectedConversationId: input.selectedConversationId,
  });
}

export function cancelWhatsAppFlow(session: WhatsAppSession): Promise<WhatsAppSession> {
  if (!session.activeFlow) return Promise.resolve(session);
  return finishWhatsAppFlow({ session });
}

export function sessionState(session: WhatsAppSession) {
  return stateObject(session.state);
}
