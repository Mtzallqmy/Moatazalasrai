import { randomBytes } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseRows } from "@/db/result";
import {
  auditLogs,
  users,
  whatsappConnections,
  whatsappLinkTokens,
} from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { hashWhatsAppConnectToken, maskWhatsAppId, normalizeWhatsAppId } from "./crypto";
import { requireWhatsAppConfig } from "./config";

const CONNECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

type LinkMetadata = {
  organizationId?: string;
  requestId?: string;
};

function metadataOrganizationId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).organizationId;
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

export function buildWhatsAppConnectUrl(displayPhoneNumber: string, rawToken: string) {
  const phone = displayPhoneNumber.replace(/\D/g, "");
  if (!/^\d{8,20}$/.test(phone)) throw new Error("WHATSAPP_DISPLAY_NUMBER_INVALID");
  if (!CONNECT_TOKEN_PATTERN.test(rawToken)) throw new Error("WHATSAPP_CONNECT_TOKEN_INVALID");
  return `https://wa.me/${phone}?text=${encodeURIComponent(`CONNECT ${rawToken}`)}`;
}

export async function createWhatsAppConnectLink(input: {
  userId: string;
  organizationId: string;
  requestId: string;
}) {
  const config = requireWhatsAppConfig();
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashWhatsAppConnectToken(rawToken, config.connectTokenSecret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.connectTokenTtlMinutes * 60_000);

  await db().transaction(async (tx) => {
    const userLock = await tx.execute(sql`
      SELECT "id" FROM "users" WHERE "id" = ${input.userId} FOR UPDATE
    `);
    if (databaseRows(userLock).length === 0) {
      throw new ApiError(404, "USER_NOT_FOUND", "تعذر إنشاء رابط WhatsApp لهذا الحساب.");
    }
    await tx.update(whatsappLinkTokens).set({ revokedAt: now }).where(and(
      eq(whatsappLinkTokens.userId, input.userId),
      isNull(whatsappLinkTokens.usedAt),
      isNull(whatsappLinkTokens.revokedAt),
    ));
    await tx.insert(whatsappLinkTokens).values({
      userId: input.userId,
      tokenHash,
      expiresAt,
      metadata: {
        organizationId: input.organizationId,
        requestId: input.requestId,
      } satisfies LinkMetadata,
    });
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "whatsapp.link_token.created",
      resourceType: "whatsapp_connection",
      resourceId: input.userId,
      metadata: { expiresAt: expiresAt.toISOString(), requestId: input.requestId },
    });
  });

  const whatsappUrl = buildWhatsAppConnectUrl(config.displayPhoneNumber, rawToken);
  return { whatsappUrl, expiresAt };
}

export type ConsumeConnectResult =
  | { ok: true; userId: string; organizationId: string | null }
  | { ok: false; reason: "invalid" | "already_linked" };

export async function consumeWhatsAppConnectToken(input: {
  token: string;
  waId: string;
  messageId: string;
}): Promise<ConsumeConnectResult> {
  if (!CONNECT_TOKEN_PATTERN.test(input.token)) return { ok: false, reason: "invalid" };
  let waId: string;
  try { waId = normalizeWhatsAppId(input.waId); } catch { return { ok: false, reason: "invalid" }; }
  const config = requireWhatsAppConfig();
  const tokenHash = hashWhatsAppConnectToken(input.token, config.connectTokenSecret);
  const now = new Date();

  try {
    return await db().transaction(async (tx) => {
      const [candidate] = await tx.select({ userId: whatsappLinkTokens.userId })
        .from(whatsappLinkTokens)
        .where(eq(whatsappLinkTokens.tokenHash, tokenHash))
        .limit(1);
      if (!candidate) return { ok: false as const, reason: "invalid" as const };

      const userLock = await tx.execute(sql`
        SELECT "id" FROM "users" WHERE "id" = ${candidate.userId} FOR UPDATE
      `);
      if (databaseRows(userLock).length === 0) return { ok: false as const, reason: "invalid" as const };

      const tokenLock = await tx.execute(sql`
        SELECT "id" FROM "whatsapp_link_tokens"
        WHERE "token_hash" = ${tokenHash}
        FOR UPDATE
      `);
      if (databaseRows(tokenLock).length === 0) return { ok: false as const, reason: "invalid" as const };

      const [token] = await tx.select().from(whatsappLinkTokens)
        .where(eq(whatsappLinkTokens.tokenHash, tokenHash)).limit(1);
      if (!token || token.userId !== candidate.userId || token.usedAt || token.revokedAt || token.expiresAt <= now) {
        return { ok: false as const, reason: "invalid" as const };
      }

      const waLock = await tx.execute(sql`
        SELECT "id" FROM "whatsapp_connections"
        WHERE "whatsapp_wa_id" = ${waId}
        FOR UPDATE
      `);
      if (databaseRows(waLock).length > 0) {
        const [owner] = await tx.select({ userId: whatsappConnections.userId })
          .from(whatsappConnections)
          .where(eq(whatsappConnections.whatsappWaId, waId))
          .limit(1);
        if (owner && owner.userId !== token.userId) {
          return { ok: false as const, reason: "already_linked" as const };
        }
      }

      const organizationId = metadataOrganizationId(token.metadata);
      const phoneNumberMasked = maskWhatsAppId(waId);
      await tx.insert(whatsappConnections).values({
        userId: token.userId,
        organizationId,
        whatsappWaId: waId,
        whatsappPhoneNumberMasked: phoneNumberMasked,
        connectionStatus: "connected",
        connectedAt: now,
        disconnectedAt: null,
        lastInteractionAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: whatsappConnections.userId,
        set: {
          organizationId,
          whatsappWaId: waId,
          whatsappPhoneNumberMasked: phoneNumberMasked,
          connectionStatus: "connected",
          connectedAt: now,
          disconnectedAt: null,
          lastInteractionAt: now,
          updatedAt: now,
        },
      });

      await tx.update(whatsappLinkTokens).set({ usedAt: now }).where(eq(whatsappLinkTokens.id, token.id));
      await tx.update(whatsappLinkTokens).set({ revokedAt: now }).where(and(
        eq(whatsappLinkTokens.userId, token.userId),
        ne(whatsappLinkTokens.id, token.id),
        isNull(whatsappLinkTokens.usedAt),
        isNull(whatsappLinkTokens.revokedAt),
      ));
      await tx.insert(auditLogs).values({
        organizationId,
        actorType: "whatsapp",
        actorId: token.userId,
        action: "whatsapp.connection.connected",
        resourceType: "whatsapp_connection",
        resourceId: token.userId,
        metadata: { messageId: input.messageId },
      });
      return { ok: true as const, userId: token.userId, organizationId };
    });
  } catch (error) {
    if (databaseCode(error) === "23505") return { ok: false, reason: "already_linked" };
    throw error;
  }
}

export async function whatsappConnectionStatus(userId: string) {
  const [connection] = await db().select({
    status: whatsappConnections.connectionStatus,
    phoneNumberMasked: whatsappConnections.whatsappPhoneNumberMasked,
    connectedAt: whatsappConnections.connectedAt,
    lastInteractionAt: whatsappConnections.lastInteractionAt,
  }).from(whatsappConnections).where(eq(whatsappConnections.userId, userId)).limit(1);
  const connected = connection?.status === "connected";
  return {
    connected,
    connectedAt: connected ? connection.connectedAt : null,
    lastInteractionAt: connected ? connection.lastInteractionAt : null,
    phoneNumberMasked: connected ? connection.phoneNumberMasked : null,
  };
}

export async function disconnectWhatsAppForUser(input: {
  userId: string;
  organizationId: string;
  requestId: string;
}) {
  const now = new Date();
  return db().transaction(async (tx) => {
    await tx.execute(sql`
      SELECT "id" FROM "users" WHERE "id" = ${input.userId} FOR UPDATE
    `);
    const [connection] = await tx.select({
      id: whatsappConnections.id,
      waId: whatsappConnections.whatsappWaId,
      status: whatsappConnections.connectionStatus,
    }).from(whatsappConnections).where(eq(whatsappConnections.userId, input.userId)).limit(1);
    const disconnected = Boolean(connection && (connection.status === "connected" || connection.waId));
    if (connection) {
      await tx.update(whatsappConnections).set({
        whatsappWaId: null,
        whatsappPhoneNumberMasked: null,
        connectionStatus: "disconnected",
        disconnectedAt: now,
        lastInteractionAt: now,
        updatedAt: now,
      }).where(eq(whatsappConnections.id, connection.id));
    }
    await tx.update(whatsappLinkTokens).set({ revokedAt: now }).where(and(
      eq(whatsappLinkTokens.userId, input.userId),
      isNull(whatsappLinkTokens.usedAt),
      isNull(whatsappLinkTokens.revokedAt),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "whatsapp.connection.disconnected",
      resourceType: "whatsapp_connection",
      resourceId: input.userId,
      metadata: { requestId: input.requestId, source: "dashboard", changed: disconnected },
    });
    return { disconnected, waId: disconnected ? connection?.waId ?? null : null };
  });
}

export async function disconnectWhatsAppByWaId(input: { waId: string; messageId: string }) {
  const waId = normalizeWhatsAppId(input.waId);
  const now = new Date();
  return db().transaction(async (tx) => {
    const lock = await tx.execute(sql`
      SELECT "id" FROM "whatsapp_connections"
      WHERE "whatsapp_wa_id" = ${waId}
      FOR UPDATE
    `);
    if (databaseRows(lock).length === 0) return { disconnected: false };
    const [connection] = await tx.select().from(whatsappConnections)
      .where(eq(whatsappConnections.whatsappWaId, waId)).limit(1);
    if (!connection || connection.connectionStatus !== "connected") return { disconnected: false };
    await tx.update(whatsappConnections).set({
      whatsappWaId: null,
      whatsappPhoneNumberMasked: null,
      connectionStatus: "disconnected",
      disconnectedAt: now,
      lastInteractionAt: now,
      updatedAt: now,
    }).where(eq(whatsappConnections.id, connection.id));
    await tx.update(whatsappLinkTokens).set({ revokedAt: now }).where(and(
      eq(whatsappLinkTokens.userId, connection.userId),
      isNull(whatsappLinkTokens.usedAt),
      isNull(whatsappLinkTokens.revokedAt),
    ));
    await tx.insert(auditLogs).values({
      organizationId: connection.organizationId,
      actorType: "whatsapp",
      actorId: connection.userId,
      action: "whatsapp.connection.disconnected",
      resourceType: "whatsapp_connection",
      resourceId: connection.userId,
      metadata: { messageId: input.messageId, source: "whatsapp" },
    });
    return { disconnected: true };
  });
}

export async function connectedWhatsAppUser(waIdValue: string) {
  const waId = normalizeWhatsAppId(waIdValue);
  const [row] = await db().select({
    connectionId: whatsappConnections.id,
    userId: whatsappConnections.userId,
    organizationId: whatsappConnections.organizationId,
    name: users.name,
    email: users.email,
  }).from(whatsappConnections)
    .innerJoin(users, eq(users.id, whatsappConnections.userId))
    .where(and(
      eq(whatsappConnections.whatsappWaId, waId),
      eq(whatsappConnections.connectionStatus, "connected"),
    )).limit(1);
  return row ?? null;
}

export async function touchWhatsAppInteraction(connectionId: string) {
  await db().update(whatsappConnections).set({
    lastInteractionAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(whatsappConnections.id, connectionId));
}

export function parseConnectToken(text: string) {
  const match = /^CONNECT\s+([A-Za-z0-9_-]{32,128})$/i.exec(text.trim());
  return match?.[1] ?? null;
}

export function assertValidDisplayPhoneNumber(value: string) {
  const normalized = value.replace(/\D/g, "");
  if (!/^\d{8,20}$/.test(normalized)) {
    throw new ApiError(503, "WHATSAPP_DISPLAY_NUMBER_INVALID", "رقم WhatsApp العام غير مهيأ بصورة صحيحة.");
  }
  return normalized;
}
