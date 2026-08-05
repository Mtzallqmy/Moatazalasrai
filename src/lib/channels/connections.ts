// Connection service resolves credentials, bootstraps environment-backed WhatsApp, and persists health.
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  channelConnections,
  channelPermissions,
  channelToolBindings,
  type ChannelPermissionName,
} from "@/db/channel-schema";
import { auditLogs, integrations } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { decryptSecret } from "@/lib/security/encryption";
import { channelAdapter } from "./registry";
import type { ChannelAdapterContext, ChannelKind, ChannelRoutingPolicy } from "./types";

export const DEFAULT_CHANNEL_PERMISSIONS: ChannelPermissionName[] = [
  "ai.chat",
  "agent.use",
  "conversation.open",
  "files.use",
  "handoff.request",
];

export type ChannelConnectionRow = typeof channelConnections.$inferSelect;

export async function channelAdapterContext(connection: ChannelConnectionRow): Promise<ChannelAdapterContext> {
  if (connection.kind === "whatsapp") {
    const config = requireWhatsAppConfig();
    return {
      organizationId: connection.organizationId,
      connectionId: connection.id,
      externalAccountId: connection.externalAccountId,
      credentials: {
        kind: "whatsapp",
        accessToken: config.accessToken,
        phoneNumberId: connection.externalAccountId,
        graphApiVersion: config.graphApiVersion,
      },
    };
  }
  if (!connection.integrationId) {
    throw new ApiError(503, "TELEGRAM_INTEGRATION_MISSING", "اتصال Telegram لا يرتبط بتكامل صالح.");
  }
  const [integration] = await db().select().from(integrations).where(and(
    eq(integrations.id, connection.integrationId),
    eq(integrations.organizationId, connection.organizationId),
    eq(integrations.kind, "telegram"),
    eq(integrations.enabled, true),
    eq(integrations.status, "verified"),
  )).limit(1);
  if (!integration) throw new ApiError(503, "TELEGRAM_INTEGRATION_UNAVAILABLE", "تكامل Telegram معطل أو غير متحقق.");
  return {
    organizationId: connection.organizationId,
    connectionId: connection.id,
    externalAccountId: connection.externalAccountId,
    credentials: {
      kind: "telegram",
      token: decryptSecret(integration.encryptedToken, `integration:${connection.organizationId}`),
    },
  };
}

export async function channelRoutingPolicy(connection: ChannelConnectionRow): Promise<ChannelRoutingPolicy> {
  const [[permission], toolRows] = await Promise.all([
    db().select().from(channelPermissions).where(and(
      eq(channelPermissions.connectionId, connection.id),
      eq(channelPermissions.organizationId, connection.organizationId),
    )).limit(1),
    db().select({ toolId: channelToolBindings.toolId }).from(channelToolBindings).where(and(
      eq(channelToolBindings.connectionId, connection.id),
      eq(channelToolBindings.organizationId, connection.organizationId),
      eq(channelToolBindings.enabled, true),
    )),
  ]);
  return {
    settings: connection.settings,
    permissions: new Set(permission?.permissions ?? DEFAULT_CHANNEL_PERMISSIONS),
    blockedOperations: new Set(permission?.blockedOperations ?? ["financial", "sensitive"]),
    allowedCommands: new Set(permission?.allowedCommands ?? connection.settings.allowedCommands ?? []),
    allowedToolIds: toolRows.map((row) => row.toolId),
  };
}

export async function testAndPersistChannelConnection(connection: ChannelConnectionRow) {
  const context = await channelAdapterContext(connection);
  const health = await channelAdapter(connection.kind).test(context);
  await db().update(channelConnections).set({
    status: health.status === "healthy" ? "healthy" : health.status === "degraded" ? "degraded" : "failed",
    lastHealthAt: new Date(health.checkedAt),
    lastErrorCode: health.errorCode ?? null,
    updatedAt: new Date(),
  }).where(and(
    eq(channelConnections.id, connection.id),
    eq(channelConnections.organizationId, connection.organizationId),
  ));
  return health;
}

export async function adoptEnvironmentWhatsApp(input: {
  organizationId: string;
  actorUserId: string;
  name?: string;
}) {
  const config = requireWhatsAppConfig();
  const [assignedElsewhere] = await db().select({
    id: channelConnections.id,
    organizationId: channelConnections.organizationId,
  }).from(channelConnections).where(and(
    eq(channelConnections.kind, "whatsapp"),
    eq(channelConnections.externalAccountId, config.phoneNumberId),
    ne(channelConnections.organizationId, input.organizationId),
  )).limit(1);
  if (assignedElsewhere) {
    throw new ApiError(409, "WHATSAPP_PHONE_ALREADY_ASSIGNED", "Phone Number ID مرتبط بمؤسسة أخرى داخل المنصة.");
  }
  const provisional: ChannelConnectionRow = {
    id: "environment-test",
    organizationId: input.organizationId,
    kind: "whatsapp",
    integrationId: null,
    name: input.name?.trim() || "WhatsApp Business",
    externalAccountId: config.phoneNumberId,
    displayAddress: config.displayPhoneNumber,
    credentialSource: "environment",
    defaultAgentId: null,
    defaultProviderCredentialId: null,
    defaultModel: null,
    inboxId: null,
    workflowId: null,
    settings: {
      welcomeMessage: "مرحبًا بك. كيف يمكننا مساعدتك؟",
      autoReplyEnabled: true,
      handoffMode: "ai_then_human",
      language: "ar",
      memoryEnabled: false,
      historyEnabled: true,
      monthlyMessageLimit: 10_000,
      allowedCommands: ["menu", "new", "human", "status"],
    },
    status: "pending",
    enabled: true,
    webhookStatus: "configured",
    webhookLastVerifiedAt: null,
    lastHealthAt: null,
    lastErrorCode: null,
    createdByUserId: input.actorUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const health = await channelAdapter("whatsapp").test(await channelAdapterContext(provisional));
  if (health.status === "failed") {
    throw new ApiError(422, health.errorCode ?? "WHATSAPP_HEALTH_FAILED", health.details);
  }
  const [connection] = await db().insert(channelConnections).values({
    organizationId: input.organizationId,
    kind: "whatsapp",
    name: provisional.name,
    externalAccountId: config.phoneNumberId,
    displayAddress: config.displayPhoneNumber,
    credentialSource: "environment",
    settings: provisional.settings,
    status: health.status,
    enabled: true,
    webhookStatus: "configured",
    webhookLastVerifiedAt: new Date(),
    lastHealthAt: new Date(health.checkedAt),
    lastErrorCode: health.errorCode ?? null,
    createdByUserId: input.actorUserId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [channelConnections.organizationId, channelConnections.kind, channelConnections.externalAccountId],
    set: {
      name: provisional.name,
      displayAddress: config.displayPhoneNumber,
      credentialSource: "environment",
      status: health.status,
      enabled: true,
      webhookStatus: "configured",
      webhookLastVerifiedAt: new Date(),
      lastHealthAt: new Date(health.checkedAt),
      lastErrorCode: health.errorCode ?? null,
      updatedAt: new Date(),
    },
  }).returning();
  if (!connection) throw new Error("WHATSAPP_CHANNEL_ADOPTION_FAILED");
  await db().insert(channelPermissions).values({
    connectionId: connection.id,
    organizationId: input.organizationId,
    permissions: DEFAULT_CHANNEL_PERMISSIONS,
    blockedOperations: ["financial", "sensitive"],
    allowedCommands: ["menu", "new", "human", "status"],
    updatedByUserId: input.actorUserId,
  }).onConflictDoNothing();
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "channel.whatsapp.environment_adopted",
    resourceType: "channel_connection",
    resourceId: connection.id,
    metadata: { phoneNumberId: config.phoneNumberId, health: health.status },
  });
  return { connection, health };
}

export async function ensureTelegramChannelConnection(input: {
  integration: typeof integrations.$inferSelect;
  actorUserId?: string | null;
}) {
  if (input.integration.kind !== "telegram") throw new Error("TELEGRAM_INTEGRATION_REQUIRED");
  const botId = typeof input.integration.config.botId === "number" || typeof input.integration.config.botId === "string"
    ? String(input.integration.config.botId)
    : null;
  if (!botId) throw new ApiError(422, "TELEGRAM_BOT_ID_MISSING", "لا يحتوي تكامل Telegram على Bot ID متحقق.");
  const defaultAgentId = typeof input.integration.config.agentId === "string" ? input.integration.config.agentId : null;
  const [connection] = await db().insert(channelConnections).values({
    organizationId: input.integration.organizationId,
    kind: "telegram",
    integrationId: input.integration.id,
    name: input.integration.name,
    externalAccountId: botId,
    displayAddress: typeof input.integration.config.botUsername === "string"
      ? `@${input.integration.config.botUsername}`
      : null,
    credentialSource: "integration",
    defaultAgentId,
    settings: {
      welcomeMessage: "مرحبًا بك. أرسل رسالة للدردشة مع الوكيل.",
      autoReplyEnabled: true,
      handoffMode: "ai_then_human",
      language: "ar",
      memoryEnabled: false,
      historyEnabled: true,
      monthlyMessageLimit: 10_000,
      allowedCommands: ["start", "help", "new", "human", "status", "github"],
    },
    status: input.integration.enabled ? "healthy" : "disabled",
    enabled: input.integration.enabled,
    webhookStatus: input.integration.config.webhookActive === true ? "active" : "inactive",
    webhookLastVerifiedAt: input.integration.lastVerifiedAt,
    lastHealthAt: input.integration.lastVerifiedAt,
    lastErrorCode: input.integration.lastErrorCode,
    createdByUserId: input.actorUserId ?? null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [channelConnections.organizationId, channelConnections.kind, channelConnections.externalAccountId],
    set: {
      integrationId: input.integration.id,
      name: input.integration.name,
      displayAddress: typeof input.integration.config.botUsername === "string"
        ? `@${input.integration.config.botUsername}`
        : null,
      defaultAgentId,
      status: input.integration.enabled ? "healthy" : "disabled",
      enabled: input.integration.enabled,
      webhookStatus: input.integration.config.webhookActive === true ? "active" : "inactive",
      lastErrorCode: input.integration.lastErrorCode,
      updatedAt: new Date(),
    },
  }).returning();
  if (!connection) throw new Error("TELEGRAM_CHANNEL_SYNC_FAILED");
  await db().insert(channelPermissions).values({
    connectionId: connection.id,
    organizationId: connection.organizationId,
    permissions: DEFAULT_CHANNEL_PERMISSIONS,
    blockedOperations: ["financial", "sensitive"],
    allowedCommands: ["start", "help", "new", "human", "status", "github"],
    updatedByUserId: input.actorUserId ?? null,
  }).onConflictDoNothing();
  return connection;
}

export async function channelConnectionForWebhook(input: {
  kind: ChannelKind;
  externalAccountId?: string;
  integrationId?: string;
}) {
  const rows = await db().select().from(channelConnections).where(and(
    eq(channelConnections.kind, input.kind),
    eq(channelConnections.enabled, true),
    input.externalAccountId ? eq(channelConnections.externalAccountId, input.externalAccountId) : undefined,
    input.integrationId ? eq(channelConnections.integrationId, input.integrationId) : undefined,
  )).limit(2);
  if (rows.length > 1) throw new ApiError(500, "CHANNEL_CONNECTION_AMBIGUOUS", "يوجد أكثر من اتصال للقناة الخارجية نفسها.");
  return rows[0] ?? null;
}
