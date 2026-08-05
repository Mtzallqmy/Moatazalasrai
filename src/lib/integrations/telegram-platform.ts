import { createHmac, randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers } from "@/db/schema";
import { telegramAccountLinks, telegramFeaturePermissions, telegramLinkCodes } from "@/db/telegram-platform-schema";
import { ApiError } from "@/lib/http/api";
import { secureStringEquals } from "@/lib/integrations/whatsapp/crypto";
import { verifyTelegramToken } from "./telegram";

export const TELEGRAM_FEATURE_KEYS = [
  "telegram.chat",
  "telegram.agents",
  "telegram.files",
  "telegram.images",
  "telegram.audio",
  "telegram.video",
  "telegram.notifications",
  "telegram.admin_commands",
] as const;
export type TelegramFeatureKey = typeof TELEGRAM_FEATURE_KEYS[number];

export const TELEGRAM_DEFAULT_ADMIN_FEATURES: TelegramFeatureKey[] = [
  "telegram.chat",
  "telegram.agents",
  "telegram.files",
  "telegram.images",
  "telegram.audio",
  "telegram.video",
  "telegram.admin_commands",
];

const TELEGRAM_ADMIN_ROLES = new Set(["owner", "admin"]);

export type TelegramPlatformConfig = {
  enabled: boolean;
  botToken?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  linkCodeSecret?: string;
  linkCodeTtlMinutes: number;
  linkCodeMaxAttempts: number;
  linkCodeLength: number;
  allowUserBotTokens: boolean;
  updateMode: "webhook" | "polling";
  webhookMaxBytes: number;
  publicAppUrl?: string;
};

function bool(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
function integer(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} is invalid.`);
  return value;
}
function optional(name: string) { return process.env[name]?.trim() || undefined; }

export function telegramPlatformConfig(): TelegramPlatformConfig {
  const enabled = bool("TELEGRAM_INTEGRATION_ENABLED");
  const publicAppUrl = optional("PUBLIC_APP_URL") ?? optional("APP_URL");
  const explicitWebhook = optional("TELEGRAM_WEBHOOK_URL");
  const webhookUrl = explicitWebhook ?? (publicAppUrl ? `${publicAppUrl.replace(/\/$/, "")}/api/webhooks/telegram` : undefined);
  const config: TelegramPlatformConfig = {
    enabled,
    botToken: optional("TELEGRAM_BOT_TOKEN"),
    webhookUrl,
    webhookSecret: optional("TELEGRAM_WEBHOOK_SECRET"),
    linkCodeSecret: optional("TELEGRAM_LINK_CODE_SECRET"),
    linkCodeTtlMinutes: integer("TELEGRAM_LINK_CODE_TTL_MINUTES", 10, 1, 60),
    linkCodeMaxAttempts: integer("TELEGRAM_LINK_CODE_MAX_ATTEMPTS", 5, 1, 20),
    linkCodeLength: integer("TELEGRAM_LINK_CODE_LENGTH", 6, 6, 10),
    allowUserBotTokens: bool("TELEGRAM_ALLOW_USER_BOT_TOKENS", false),
    updateMode: optional("TELEGRAM_UPDATE_MODE") === "polling" ? "polling" : "webhook",
    webhookMaxBytes: integer("TELEGRAM_WEBHOOK_MAX_BYTES", 1_048_576, 1_024, 10_485_760),
    publicAppUrl,
  };
  if (enabled) {
    if (!config.botToken) throw new Error("TELEGRAM_BOT_TOKEN is required when TELEGRAM_INTEGRATION_ENABLED is true.");
    if (!config.webhookSecret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_INTEGRATION_ENABLED is true.");
    if (!config.linkCodeSecret) throw new Error("TELEGRAM_LINK_CODE_SECRET is required when TELEGRAM_INTEGRATION_ENABLED is true.");
    if (!config.publicAppUrl) throw new Error("PUBLIC_APP_URL or APP_URL is required when TELEGRAM_INTEGRATION_ENABLED is true.");
    if (config.webhookSecret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET must contain at least 16 characters.");
    if (config.linkCodeSecret.length < 32) throw new Error("TELEGRAM_LINK_CODE_SECRET must contain at least 32 characters.");
  }
  if (process.env.NODE_ENV === "production") {
    if (config.publicAppUrl && !config.publicAppUrl.startsWith("https://")) throw new Error("Telegram public URL must use HTTPS in production.");
    if (config.webhookUrl && !config.webhookUrl.startsWith("https://")) throw new Error("TELEGRAM_WEBHOOK_URL must use HTTPS in production.");
  }
  return config;
}

export function verifyTelegramWebhookSecret(supplied: string | null) {
  const expected = telegramPlatformConfig().webhookSecret ?? "";
  return Boolean(expected && supplied && secureStringEquals(expected, supplied));
}

export function hashTelegramLinkCode(code: string) {
  const secret = telegramPlatformConfig().linkCodeSecret;
  if (!secret) throw new Error("TELEGRAM_LINK_CODE_SECRET_MISSING");
  return createHmac("sha256", secret).update(code).digest("hex");
}

function hashRequestValue(value: string | null | undefined) {
  if (!value) return null;
  const secret = telegramPlatformConfig().linkCodeSecret;
  if (!secret) return null;
  return createHmac("sha256", secret).update(value.slice(0, 1000)).digest("hex");
}

function isTelegramAdminRole(role: string | null | undefined) {
  return Boolean(role && TELEGRAM_ADMIN_ROLES.has(role));
}

export async function centralTelegramBot() {
  const config = telegramPlatformConfig();
  if (!config.enabled || !config.botToken) throw new ApiError(503, "TELEGRAM_DISABLED", "تكامل Telegram المركزي غير مفعّل.");
  const bot = await verifyTelegramToken(config.botToken);
  if (!bot.username) throw new ApiError(503, "TELEGRAM_USERNAME_MISSING", "بوت Telegram لا يملك اسم مستخدم.");
  return { ...bot, token: config.botToken };
}

export async function createTelegramLinkCode(input: {
  userId: string;
  organizationId: string;
  requestIp?: string | null;
  userAgent?: string | null;
}) {
  const config = telegramPlatformConfig();
  const bot = await centralTelegramBot();
  const upper = 10 ** config.linkCodeLength;
  const lower = 10 ** (config.linkCodeLength - 1);
  const code = String(randomInt(lower, upper));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.linkCodeTtlMinutes * 60_000);
  await db().transaction(async (tx) => {
    await tx.execute(sql`SELECT "id" FROM "users" WHERE "id" = ${input.userId} FOR UPDATE`);
    await tx.update(telegramLinkCodes).set({ revokedAt: now }).where(and(
      eq(telegramLinkCodes.userId, input.userId),
      isNull(telegramLinkCodes.consumedAt),
      isNull(telegramLinkCodes.revokedAt),
    ));
    await tx.insert(telegramLinkCodes).values({
      userId: input.userId,
      organizationId: input.organizationId,
      codeHash: hashTelegramLinkCode(code),
      expiresAt,
      maxAttempts: config.linkCodeMaxAttempts,
      requestIpHash: hashRequestValue(input.requestIp),
      userAgentHash: hashRequestValue(input.userAgent),
    });
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "telegram.link_code.created",
      resourceType: "telegram_account_link",
      resourceId: input.userId,
      metadata: { expiresAt: expiresAt.toISOString() },
    });
  });
  return {
    code,
    expiresAt,
    botUsername: bot.username,
    deepLink: `https://t.me/${bot.username}?start=link_${code}`,
    appDeepLink: `tg://resolve?domain=${bot.username}&start=link_${code}`,
  };
}

export async function consumeTelegramLinkCode(input: {
  code: string;
  telegramUserId: string;
  telegramChatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}) {
  if (!/^\d{6,10}$/.test(input.code)) return { ok: false as const };
  const codeHash = hashTelegramLinkCode(input.code);
  const now = new Date();
  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT "id" FROM "telegram_link_codes" WHERE "code_hash" = ${codeHash} FOR UPDATE`);
    const [code] = await tx.select().from(telegramLinkCodes).where(eq(telegramLinkCodes.codeHash, codeHash)).limit(1);
    if (!code || code.consumedAt || code.revokedAt || code.expiresAt <= now || code.attemptCount >= code.maxAttempts) {
      if (code && !code.consumedAt && !code.revokedAt) {
        await tx.update(telegramLinkCodes).set({ attemptCount: code.attemptCount + 1 }).where(eq(telegramLinkCodes.id, code.id));
      }
      return { ok: false as const };
    }

    await tx.execute(sql`
      SELECT "id" FROM "telegram_account_links"
      WHERE "telegram_user_id" = ${input.telegramUserId} OR "user_id" = ${code.userId}
      FOR UPDATE
    `);
    const [existingTelegram] = await tx.select({ userId: telegramAccountLinks.userId })
      .from(telegramAccountLinks).where(eq(telegramAccountLinks.telegramUserId, input.telegramUserId)).limit(1);
    if (existingTelegram && existingTelegram.userId !== code.userId) return { ok: false as const };

    const [existingUser] = await tx.select({
      telegramUserId: telegramAccountLinks.telegramUserId,
      status: telegramAccountLinks.status,
    }).from(telegramAccountLinks).where(eq(telegramAccountLinks.userId, code.userId)).limit(1);
    if (existingUser?.status === "active" && existingUser.telegramUserId !== input.telegramUserId) {
      return { ok: false as const };
    }

    const [membership] = await tx.select({
      userId: organizationMembers.userId,
      role: organizationMembers.role,
    }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, code.organizationId),
      eq(organizationMembers.userId, code.userId),
    )).limit(1);
    if (!membership) return { ok: false as const };

    await tx.insert(telegramAccountLinks).values({
      userId: code.userId,
      organizationId: code.organizationId,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      telegramUsername: input.username,
      telegramFirstName: input.firstName,
      telegramLastName: input.lastName,
      status: "active",
      linkedAt: now,
      lastSeenAt: now,
      revokedAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: telegramAccountLinks.userId,
      set: {
        organizationId: code.organizationId,
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        telegramUsername: input.username,
        telegramFirstName: input.firstName,
        telegramLastName: input.lastName,
        status: "active",
        linkedAt: now,
        lastSeenAt: now,
        revokedAt: null,
        updatedAt: now,
      },
    });

    if (isTelegramAdminRole(membership.role)) {
      for (const featureKey of TELEGRAM_DEFAULT_ADMIN_FEATURES) {
        await tx.insert(telegramFeaturePermissions).values({
          userId: code.userId,
          organizationId: code.organizationId,
          featureKey,
          enabled: true,
          limits: {},
          updatedBy: code.userId,
        }).onConflictDoNothing();
      }
    }

    await tx.update(telegramLinkCodes).set({ consumedAt: now }).where(eq(telegramLinkCodes.id, code.id));
    await tx.insert(auditLogs).values({
      organizationId: code.organizationId,
      actorType: "telegram",
      actorId: code.userId,
      action: "telegram.account.linked",
      resourceType: "telegram_account_link",
      resourceId: code.userId,
      metadata: { defaultFeaturesSeeded: isTelegramAdminRole(membership.role) },
    });
    return { ok: true as const, userId: code.userId, organizationId: code.organizationId };
  });
}

export async function telegramLinkStatus(userId: string, organizationId: string) {
  const [link] = await db().select({
    username: telegramAccountLinks.telegramUsername,
    firstName: telegramAccountLinks.telegramFirstName,
    lastName: telegramAccountLinks.telegramLastName,
    status: telegramAccountLinks.status,
    linkedAt: telegramAccountLinks.linkedAt,
    lastSeenAt: telegramAccountLinks.lastSeenAt,
  }).from(telegramAccountLinks).where(and(
    eq(telegramAccountLinks.userId, userId),
    eq(telegramAccountLinks.organizationId, organizationId),
  )).limit(1);
  const permissions = await db().select({
    featureKey: telegramFeaturePermissions.featureKey,
    enabled: telegramFeaturePermissions.enabled,
    limits: telegramFeaturePermissions.limits,
  }).from(telegramFeaturePermissions).where(and(
    eq(telegramFeaturePermissions.userId, userId),
    eq(telegramFeaturePermissions.organizationId, organizationId),
  ));
  const bot = telegramPlatformConfig().enabled ? await centralTelegramBot().catch(() => null) : null;
  return { linked: link?.status === "active", link: link ?? null, permissions, botUsername: bot?.username ?? null };
}

export async function unlinkTelegramAccount(input: { userId: string; organizationId: string; actorUserId: string }) {
  const now = new Date();
  const [row] = await db().update(telegramAccountLinks).set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(and(eq(telegramAccountLinks.userId, input.userId), eq(telegramAccountLinks.organizationId, input.organizationId)))
    .returning({ id: telegramAccountLinks.id });
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "telegram.account.unlinked",
    resourceType: "telegram_account_link",
    resourceId: input.userId,
    metadata: { changed: Boolean(row) },
  });
  return { unlinked: Boolean(row) };
}

export async function resolveTelegramAccount(telegramUserId: string) {
  const [link] = await db().select().from(telegramAccountLinks).where(and(
    eq(telegramAccountLinks.telegramUserId, telegramUserId),
    eq(telegramAccountLinks.status, "active"),
  )).limit(1);
  if (!link) return null;
  const now = new Date();
  await db().update(telegramAccountLinks).set({ lastSeenAt: now, updatedAt: now }).where(eq(telegramAccountLinks.id, link.id));
  return { ...link, lastSeenAt: now, updatedAt: now };
}

export async function telegramEnabledFeatures(userId: string, organizationId: string) {
  const rows = await db().select({ featureKey: telegramFeaturePermissions.featureKey })
    .from(telegramFeaturePermissions).where(and(
      eq(telegramFeaturePermissions.userId, userId),
      eq(telegramFeaturePermissions.organizationId, organizationId),
      eq(telegramFeaturePermissions.enabled, true),
    ));
  return rows.map((row) => row.featureKey as TelegramFeatureKey);
}

export async function telegramFeatureAllowed(userId: string, organizationId: string, featureKey: TelegramFeatureKey) {
  if (featureKey === "telegram.admin_commands") {
    const [membership] = await db().select({ role: organizationMembers.role }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
    )).limit(1);
    if (!isTelegramAdminRole(membership?.role)) return null;
  }
  const [row] = await db().select({ enabled: telegramFeaturePermissions.enabled, limits: telegramFeaturePermissions.limits })
    .from(telegramFeaturePermissions).where(and(
      eq(telegramFeaturePermissions.userId, userId),
      eq(telegramFeaturePermissions.organizationId, organizationId),
      eq(telegramFeaturePermissions.featureKey, featureKey),
    )).limit(1);
  return row?.enabled === true ? row : null;
}

export async function setTelegramFeaturePermission(input: {
  userId: string;
  organizationId: string;
  featureKey: TelegramFeatureKey;
  enabled: boolean;
  limits: Record<string, unknown>;
  actorUserId: string;
}) {
  const [membership] = await db().select({
    userId: organizationMembers.userId,
    role: organizationMembers.role,
  }).from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, input.organizationId),
    eq(organizationMembers.userId, input.userId),
  )).limit(1);
  if (!membership) throw new ApiError(404, "TELEGRAM_USER_NOT_FOUND", "المستخدم لا يتبع المؤسسة.");
  if (input.featureKey === "telegram.admin_commands" && input.enabled && !isTelegramAdminRole(membership.role)) {
    throw new ApiError(403, "TELEGRAM_ADMIN_COMMANDS_FORBIDDEN", "الأوامر الإدارية متاحة للمشرفين فقط.");
  }
  const [row] = await db().insert(telegramFeaturePermissions).values({
    userId: input.userId,
    organizationId: input.organizationId,
    featureKey: input.featureKey,
    enabled: input.enabled,
    limits: input.limits,
    updatedBy: input.actorUserId,
  }).onConflictDoUpdate({
    target: [telegramFeaturePermissions.userId, telegramFeaturePermissions.featureKey],
    set: { enabled: input.enabled, limits: input.limits, updatedBy: input.actorUserId, updatedAt: new Date() },
  }).returning();
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "telegram.feature_permission.updated",
    resourceType: "telegram_feature_permission",
    resourceId: `${input.userId}:${input.featureKey}`,
    metadata: { enabled: input.enabled, featureKey: input.featureKey },
  });
  return row;
}
