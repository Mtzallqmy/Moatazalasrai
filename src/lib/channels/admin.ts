// Channel administration service validates organization ownership and writes audited policies atomically.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  channelAgentBindings,
  channelConnections,
  channelConversationLinks,
  channelHandoffs,
  channelInboxes,
  channelPermissions,
  channelProviderBindings,
  channelRoutingRules,
  channelToolBindings,
  channelWorkflows,
  type ChannelPermissionName,
} from "@/db/channel-schema";
import {
  agents,
  auditLogs,
  mcpTools,
  providerCredentials,
} from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { requireWhatsAppConfig } from "@/lib/integrations/whatsapp/config";
import { DEFAULT_CHANNEL_PERMISSIONS, channelAdapterContext, testAndPersistChannelConnection } from "./connections";
import { channelAdapter } from "./registry";

const uuid = z.string().uuid();
const optionalUuid = uuid.nullable().optional();
const shortText = z.string().trim().min(1).max(160);

export const channelPermissionSchema = z.enum([
  "ai.chat",
  "agent.use",
  "tools.execute",
  "account.read",
  "conversation.open",
  "tickets.create",
  "orders.read",
  "files.use",
  "search.use",
  "workflows.execute",
  "handoff.request",
]);

const businessHoursSchema = z.object({
  timezone: z.string().trim().min(1).max(80),
  days: z.record(z.string(), z.array(z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }).strict()).max(4)),
}).strict();

export const channelConnectionUpdateSchema = z.object({
  id: uuid,
  name: shortText.optional(),
  enabled: z.boolean().optional(),
  defaultAgentId: optionalUuid,
  defaultProviderCredentialId: optionalUuid,
  defaultModel: z.string().trim().max(200).nullable().optional(),
  inboxId: optionalUuid,
  workflowId: optionalUuid,
  settings: z.object({
    welcomeMessage: z.string().trim().max(2_000).optional(),
    autoReplyEnabled: z.boolean().optional(),
    businessHours: businessHoursSchema.nullable().optional(),
    handoffMode: z.enum(["ai", "human", "ai_then_human", "human_then_ai", "keyword", "business_hours", "agent_failure", "user_request"]).optional(),
    escalationRules: z.array(z.record(z.string(), z.unknown())).max(30).optional(),
    language: z.string().trim().min(2).max(16).optional(),
    memoryEnabled: z.boolean().optional(),
    historyEnabled: z.boolean().optional(),
    monthlyMessageLimit: z.number().int().min(1).max(10_000_000).optional(),
    allowedCommands: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  }).strict().optional(),
}).strict();

export const channelBindingUpdateSchema = z.object({
  connectionId: uuid,
  agents: z.array(z.object({
    agentId: uuid,
    providerCredentialId: optionalUuid,
    model: z.string().trim().max(200).nullable().optional(),
    priority: z.number().int().min(1).max(10_000).default(100),
    enabled: z.boolean().default(true),
  }).strict()).max(50).default([]),
  providers: z.array(z.object({
    providerCredentialId: uuid,
    model: z.string().trim().max(200).nullable().optional(),
    priority: z.number().int().min(1).max(10_000).default(100),
    enabled: z.boolean().default(true),
  }).strict()).max(50).default([]),
  toolIds: z.array(uuid).max(200).default([]),
}).strict();

export const channelPermissionsUpdateSchema = z.object({
  connectionId: uuid,
  permissions: z.array(channelPermissionSchema).max(30),
  blockedOperations: z.array(z.string().trim().min(1).max(80)).max(50).default(["financial", "sensitive"]),
  allowedCommands: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
}).strict();

export const channelRulesUpdateSchema = z.object({
  connectionId: uuid,
  rules: z.array(z.object({
    id: uuid.optional(),
    name: shortText,
    conditionType: z.enum(["always", "keyword", "outside_business_hours"]),
    condition: z.record(z.string(), z.unknown()).default({}),
    action: z.enum(["route_agent", "handoff", "workflow"]),
    actionConfig: z.record(z.string(), z.unknown()).default({}),
    priority: z.number().int().min(1).max(10_000).default(100),
    enabled: z.boolean().default(true),
  }).strict()).max(100),
}).strict();

export const adoptWhatsAppSchema = z.object({
  action: z.literal("adopt_whatsapp_environment"),
  name: z.string().trim().min(2).max(160).default("WhatsApp Business"),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/).optional(),
  displayAddress: z.string().trim().max(40).optional(),
}).strict();

async function ownedConnection(organizationId: string, connectionId: string) {
  const [connection] = await db().select().from(channelConnections).where(and(
    eq(channelConnections.id, connectionId),
    eq(channelConnections.organizationId, organizationId),
  )).limit(1);
  if (!connection) throw new ApiError(404, "CHANNEL_CONNECTION_NOT_FOUND", "اتصال القناة غير موجود.");
  return connection;
}

async function validateReferences(input: {
  organizationId: string;
  agentIds?: string[];
  providerIds?: string[];
  toolIds?: string[];
  inboxId?: string | null;
  workflowId?: string | null;
}) {
  const [agentRows, providerRows, toolRows, inboxRows, workflowRows] = await Promise.all([
    input.agentIds?.length ? db().select({ id: agents.id }).from(agents).where(and(
      eq(agents.organizationId, input.organizationId),
      inArray(agents.id, input.agentIds),
    )) : Promise.resolve([]),
    input.providerIds?.length ? db().select({ id: providerCredentials.id }).from(providerCredentials).where(and(
      eq(providerCredentials.organizationId, input.organizationId),
      inArray(providerCredentials.id, input.providerIds),
      eq(providerCredentials.validationStatus, "verified"),
    )) : Promise.resolve([]),
    input.toolIds?.length ? db().select({ id: mcpTools.id }).from(mcpTools).where(and(
      eq(mcpTools.organizationId, input.organizationId),
      inArray(mcpTools.id, input.toolIds),
    )) : Promise.resolve([]),
    input.inboxId ? db().select({ id: channelInboxes.id }).from(channelInboxes).where(and(
      eq(channelInboxes.id, input.inboxId),
      eq(channelInboxes.organizationId, input.organizationId),
    )) : Promise.resolve([]),
    input.workflowId ? db().select({ id: channelWorkflows.id }).from(channelWorkflows).where(and(
      eq(channelWorkflows.id, input.workflowId),
      eq(channelWorkflows.organizationId, input.organizationId),
    )) : Promise.resolve([]),
  ]);
  if (input.agentIds && agentRows.length !== new Set(input.agentIds).size) throw new ApiError(422, "CHANNEL_AGENT_INVALID", "أحد الوكلاء لا يتبع المؤسسة.");
  if (input.providerIds && providerRows.length !== new Set(input.providerIds).size) throw new ApiError(422, "CHANNEL_PROVIDER_INVALID", "أحد المزودات غير متحقق أو لا يتبع المؤسسة.");
  if (input.toolIds && toolRows.length !== new Set(input.toolIds).size) throw new ApiError(422, "CHANNEL_TOOL_INVALID", "إحدى الأدوات لا تتبع المؤسسة.");
  if (input.inboxId && inboxRows.length !== 1) throw new ApiError(422, "CHANNEL_INBOX_INVALID", "صندوق المحادثات لا يتبع المؤسسة.");
  if (input.workflowId && workflowRows.length !== 1) throw new ApiError(422, "CHANNEL_WORKFLOW_INVALID", "سير العمل لا يتبع المؤسسة.");
}

export async function listChannelSummaries(organizationId: string) {
  return db().select({
    id: channelConnections.id,
    kind: channelConnections.kind,
    name: channelConnections.name,
    displayAddress: channelConnections.displayAddress,
    status: channelConnections.status,
    enabled: channelConnections.enabled,
    webhookStatus: channelConnections.webhookStatus,
    lastHealthAt: channelConnections.lastHealthAt,
    lastErrorCode: channelConnections.lastErrorCode,
    defaultAgentId: channelConnections.defaultAgentId,
  }).from(channelConnections)
    .where(eq(channelConnections.organizationId, organizationId))
    .orderBy(desc(channelConnections.updatedAt));
}

export async function listChannelAdministration(organizationId: string) {
  const connections = await db().select().from(channelConnections).where(eq(channelConnections.organizationId, organizationId))
    .orderBy(desc(channelConnections.updatedAt));
  const ids = connections.map((connection) => connection.id);
  const [agentBindings, providerBindings, toolBindings, permissions, rules, inboxes, workflows] = await Promise.all([
    ids.length ? db().select().from(channelAgentBindings).where(and(
      eq(channelAgentBindings.organizationId, organizationId),
      inArray(channelAgentBindings.connectionId, ids),
    )).orderBy(asc(channelAgentBindings.priority)) : Promise.resolve([]),
    ids.length ? db().select().from(channelProviderBindings).where(and(
      eq(channelProviderBindings.organizationId, organizationId),
      inArray(channelProviderBindings.connectionId, ids),
    )).orderBy(asc(channelProviderBindings.priority)) : Promise.resolve([]),
    ids.length ? db().select().from(channelToolBindings).where(and(
      eq(channelToolBindings.organizationId, organizationId),
      inArray(channelToolBindings.connectionId, ids),
      eq(channelToolBindings.enabled, true),
    )) : Promise.resolve([]),
    ids.length ? db().select().from(channelPermissions).where(and(
      eq(channelPermissions.organizationId, organizationId),
      inArray(channelPermissions.connectionId, ids),
    )) : Promise.resolve([]),
    ids.length ? db().select().from(channelRoutingRules).where(and(
      eq(channelRoutingRules.organizationId, organizationId),
      inArray(channelRoutingRules.connectionId, ids),
    )).orderBy(asc(channelRoutingRules.priority)) : Promise.resolve([]),
    db().select().from(channelInboxes).where(eq(channelInboxes.organizationId, organizationId)).orderBy(asc(channelInboxes.name)),
    db().select().from(channelWorkflows).where(eq(channelWorkflows.organizationId, organizationId)).orderBy(asc(channelWorkflows.name)),
  ]);
  return {
    connections: connections.map((connection) => ({
      ...connection,
      agentBindings: agentBindings.filter((binding) => binding.connectionId === connection.id),
      providerBindings: providerBindings.filter((binding) => binding.connectionId === connection.id),
      toolIds: toolBindings.filter((binding) => binding.connectionId === connection.id).map((binding) => binding.toolId),
      permissions: permissions.find((permission) => permission.connectionId === connection.id) ?? {
        connectionId: connection.id,
        organizationId,
        permissions: DEFAULT_CHANNEL_PERMISSIONS,
        blockedOperations: ["financial", "sensitive"],
        allowedCommands: connection.settings.allowedCommands ?? [],
        updatedByUserId: null,
        updatedAt: connection.updatedAt,
      },
      rules: rules.filter((rule) => rule.connectionId === connection.id),
    })),
    inboxes,
    workflows,
  };
}

export async function adoptWhatsAppEnvironment(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  phoneNumberId?: string;
  displayAddress?: string;
}) {
  const config = requireWhatsAppConfig();
  const phoneNumberId = input.phoneNumberId || config.phoneNumberId;
  const [existingOther] = await db().select({ id: channelConnections.id }).from(channelConnections).where(and(
    eq(channelConnections.kind, "whatsapp"),
    eq(channelConnections.externalAccountId, phoneNumberId),
  )).limit(1);
  if (existingOther) {
    const connection = await ownedConnection(input.organizationId, existingOther.id).catch(() => null);
    if (!connection) throw new ApiError(409, "WHATSAPP_PHONE_ALREADY_ASSIGNED", "Phone Number ID مرتبط بمؤسسة أخرى.");
  }
  const provisional: typeof channelConnections.$inferSelect = {
    id: existingOther?.id ?? crypto.randomUUID(),
    organizationId: input.organizationId,
    kind: "whatsapp",
    integrationId: null,
    name: input.name,
    externalAccountId: phoneNumberId,
    displayAddress: input.displayAddress || (phoneNumberId === config.phoneNumberId ? config.displayPhoneNumber : null),
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
      allowedCommands: ["menu", "new", "human", "ai", "status"],
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
  if (health.status === "failed") throw new ApiError(422, health.errorCode ?? "WHATSAPP_HEALTH_FAILED", health.details);
  const [connection] = await db().insert(channelConnections).values({
    id: provisional.id,
    organizationId: input.organizationId,
    kind: "whatsapp",
    name: input.name,
    externalAccountId: phoneNumberId,
    displayAddress: provisional.displayAddress,
    credentialSource: "environment",
    settings: provisional.settings,
    status: health.status,
    enabled: true,
    webhookStatus: "configured",
    webhookLastVerifiedAt: new Date(),
    lastHealthAt: new Date(health.checkedAt),
    createdByUserId: input.actorUserId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [channelConnections.organizationId, channelConnections.kind, channelConnections.externalAccountId],
    set: {
      name: input.name,
      displayAddress: provisional.displayAddress,
      credentialSource: "environment",
      status: health.status,
      enabled: true,
      webhookStatus: "configured",
      webhookLastVerifiedAt: new Date(),
      lastHealthAt: new Date(health.checkedAt),
      lastErrorCode: null,
      updatedAt: new Date(),
    },
  }).returning();
  if (!connection) throw new Error("CHANNEL_CONNECTION_CREATE_FAILED");
  await db().insert(channelPermissions).values({
    connectionId: connection.id,
    organizationId: input.organizationId,
    permissions: DEFAULT_CHANNEL_PERMISSIONS,
    blockedOperations: ["financial", "sensitive"],
    allowedCommands: ["menu", "new", "human", "ai", "status"],
    updatedByUserId: input.actorUserId,
  }).onConflictDoNothing();
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "channel.connection.created",
    resourceType: "channel_connection",
    resourceId: connection.id,
    metadata: { kind: "whatsapp", phoneNumberId, credentialSource: "environment" },
  });
  return { connection, health };
}

export async function updateChannelConnection(input: {
  organizationId: string;
  actorUserId: string;
  update: z.infer<typeof channelConnectionUpdateSchema>;
}) {
  const current = await ownedConnection(input.organizationId, input.update.id);
  await validateReferences({
    organizationId: input.organizationId,
    agentIds: input.update.defaultAgentId ? [input.update.defaultAgentId] : undefined,
    providerIds: input.update.defaultProviderCredentialId ? [input.update.defaultProviderCredentialId] : undefined,
    inboxId: input.update.inboxId,
    workflowId: input.update.workflowId,
  });
  const settings = input.update.settings ? { ...current.settings, ...input.update.settings } : current.settings;
  const [updated] = await db().update(channelConnections).set({
    ...(input.update.name !== undefined ? { name: input.update.name } : {}),
    ...(input.update.enabled !== undefined ? {
      enabled: input.update.enabled,
      status: input.update.enabled ? current.status === "disabled" ? "pending" : current.status : "disabled",
    } : {}),
    ...(input.update.defaultAgentId !== undefined ? { defaultAgentId: input.update.defaultAgentId } : {}),
    ...(input.update.defaultProviderCredentialId !== undefined ? { defaultProviderCredentialId: input.update.defaultProviderCredentialId } : {}),
    ...(input.update.defaultModel !== undefined ? { defaultModel: input.update.defaultModel } : {}),
    ...(input.update.inboxId !== undefined ? { inboxId: input.update.inboxId } : {}),
    ...(input.update.workflowId !== undefined ? { workflowId: input.update.workflowId } : {}),
    settings,
    updatedAt: new Date(),
  }).where(and(
    eq(channelConnections.id, current.id),
    eq(channelConnections.organizationId, input.organizationId),
  )).returning();
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "channel.connection.updated",
    resourceType: "channel_connection",
    resourceId: current.id,
    metadata: {
      enabled: input.update.enabled,
      defaultAgentId: input.update.defaultAgentId,
      defaultProviderCredentialId: input.update.defaultProviderCredentialId,
      model: input.update.defaultModel,
    },
  });
  return updated;
}

export async function replaceChannelBindings(input: {
  organizationId: string;
  actorUserId: string;
  update: z.infer<typeof channelBindingUpdateSchema>;
}) {
  await ownedConnection(input.organizationId, input.update.connectionId);
  const agentIds = input.update.agents.map((binding) => binding.agentId);
  const providerIds = [
    ...input.update.providers.map((binding) => binding.providerCredentialId),
    ...input.update.agents.flatMap((binding) => binding.providerCredentialId ? [binding.providerCredentialId] : []),
  ];
  await validateReferences({
    organizationId: input.organizationId,
    agentIds,
    providerIds,
    toolIds: input.update.toolIds,
  });
  await db().transaction(async (tx) => {
    await tx.delete(channelAgentBindings).where(and(
      eq(channelAgentBindings.organizationId, input.organizationId),
      eq(channelAgentBindings.connectionId, input.update.connectionId),
    ));
    await tx.delete(channelProviderBindings).where(and(
      eq(channelProviderBindings.organizationId, input.organizationId),
      eq(channelProviderBindings.connectionId, input.update.connectionId),
    ));
    await tx.delete(channelToolBindings).where(and(
      eq(channelToolBindings.organizationId, input.organizationId),
      eq(channelToolBindings.connectionId, input.update.connectionId),
    ));
    if (input.update.agents.length) await tx.insert(channelAgentBindings).values(input.update.agents.map((binding) => ({
      organizationId: input.organizationId,
      connectionId: input.update.connectionId,
      agentId: binding.agentId,
      providerCredentialId: binding.providerCredentialId,
      model: binding.model,
      priority: binding.priority,
      enabled: binding.enabled,
    })));
    if (input.update.providers.length) await tx.insert(channelProviderBindings).values(input.update.providers.map((binding) => ({
      organizationId: input.organizationId,
      connectionId: input.update.connectionId,
      providerCredentialId: binding.providerCredentialId,
      model: binding.model,
      priority: binding.priority,
      enabled: binding.enabled,
    })));
    if (input.update.toolIds.length) await tx.insert(channelToolBindings).values(input.update.toolIds.map((toolId) => ({
      organizationId: input.organizationId,
      connectionId: input.update.connectionId,
      toolId,
    })));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "channel.bindings.replaced",
      resourceType: "channel_connection",
      resourceId: input.update.connectionId,
      metadata: { agentIds, providerIds, toolIds: input.update.toolIds },
    });
  });
}

export async function replaceChannelPermissions(input: {
  organizationId: string;
  actorUserId: string;
  update: z.infer<typeof channelPermissionsUpdateSchema>;
}) {
  await ownedConnection(input.organizationId, input.update.connectionId);
  await db().transaction(async (tx) => {
    await tx.insert(channelPermissions).values({
      connectionId: input.update.connectionId,
      organizationId: input.organizationId,
      permissions: input.update.permissions as ChannelPermissionName[],
      blockedOperations: input.update.blockedOperations,
      allowedCommands: input.update.allowedCommands,
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: channelPermissions.connectionId,
      set: {
        permissions: input.update.permissions as ChannelPermissionName[],
        blockedOperations: input.update.blockedOperations,
        allowedCommands: input.update.allowedCommands,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      },
    });
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "channel.permissions.updated",
      resourceType: "channel_connection",
      resourceId: input.update.connectionId,
      metadata: input.update,
    });
  });
}

export async function replaceChannelRules(input: {
  organizationId: string;
  actorUserId: string;
  update: z.infer<typeof channelRulesUpdateSchema>;
}) {
  await ownedConnection(input.organizationId, input.update.connectionId);
  await db().transaction(async (tx) => {
    await tx.delete(channelRoutingRules).where(and(
      eq(channelRoutingRules.organizationId, input.organizationId),
      eq(channelRoutingRules.connectionId, input.update.connectionId),
    ));
    if (input.update.rules.length) await tx.insert(channelRoutingRules).values(input.update.rules.map((rule) => ({
      organizationId: input.organizationId,
      connectionId: input.update.connectionId,
      name: rule.name,
      conditionType: rule.conditionType,
      condition: rule.condition,
      action: rule.action,
      actionConfig: rule.actionConfig,
      priority: rule.priority,
      enabled: rule.enabled,
    })));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "channel.routing_rules.updated",
      resourceType: "channel_connection",
      resourceId: input.update.connectionId,
      metadata: { ruleCount: input.update.rules.length },
    });
  });
}

export async function testChannelConnection(organizationId: string, connectionId: string) {
  return testAndPersistChannelConnection(await ownedConnection(organizationId, connectionId));
}

export async function sendChannelTestMessage(input: {
  organizationId: string;
  actorUserId: string;
  connectionId: string;
  to: string;
  text: string;
}) {
  const connection = await ownedConnection(input.organizationId, input.connectionId);
  if (!connection.enabled) throw new ApiError(409, "CHANNEL_DISABLED", "فعّل اتصال القناة قبل إرسال رسالة الاختبار.");
  const sent = await channelAdapter(connection.kind).send(await channelAdapterContext(connection), {
    to: input.to,
    text: input.text.slice(0, 2_000),
  });
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "channel.test_message.sent",
    resourceType: "channel_connection",
    resourceId: connection.id,
    metadata: { externalMessageId: sent.externalMessageId },
  });
  return sent;
}

export async function requestAdminHandoff(input: {
  organizationId: string;
  actorUserId: string;
  connectionId: string;
  conversationLinkId: string;
  assignedUserId?: string | null;
  reason: string;
}) {
  await ownedConnection(input.organizationId, input.connectionId);
  const [link] = await db().select().from(channelConversationLinks).where(and(
    eq(channelConversationLinks.id, input.conversationLinkId),
    eq(channelConversationLinks.organizationId, input.organizationId),
    eq(channelConversationLinks.connectionId, input.connectionId),
  )).limit(1);
  if (!link) throw new ApiError(404, "CHANNEL_CONVERSATION_NOT_FOUND", "محادثة القناة غير موجودة.");
  const [handoff] = await db().insert(channelHandoffs).values({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    conversationLinkId: link.id,
    fromMode: link.mode,
    toMode: "human",
    reason: input.reason,
    requestedBy: "user",
    assignedUserId: input.assignedUserId,
    status: input.assignedUserId ? "assigned" : "requested",
  }).returning();
  await db().update(channelConversationLinks).set({
    mode: "human",
    assignedUserId: input.assignedUserId,
    status: input.assignedUserId ? "human_assigned" : "handoff_requested",
    updatedAt: new Date(),
  }).where(eq(channelConversationLinks.id, link.id));
  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "channel.handoff.admin_requested",
    resourceType: "channel_handoff",
    resourceId: handoff?.id,
    metadata: { connectionId: input.connectionId, conversationLinkId: link.id, assignedUserId: input.assignedUserId },
  });
  return handoff;
}

export async function deleteChannelConnection(input: {
  organizationId: string;
  actorUserId: string;
  connectionId: string;
}) {
  const connection = await ownedConnection(input.organizationId, input.connectionId);
  await db().transaction(async (tx) => {
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.actorUserId,
      action: "channel.connection.unlinked",
      resourceType: "channel_connection",
      resourceId: connection.id,
      metadata: { kind: connection.kind, externalAccountId: connection.externalAccountId },
    });
    await tx.delete(channelConnections).where(and(
      eq(channelConnections.id, connection.id),
      eq(channelConnections.organizationId, input.organizationId),
    ));
  });
  return { deleted: true };
}
