// Shared channel schema for organization-owned Telegram and WhatsApp routing.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  agents,
  conversations,
  integrations,
  mcpTools,
  organizations,
  providerCredentials,
  users,
} from "@/db/schema";

export const channelKind = pgEnum("channel_kind", ["telegram", "whatsapp"]);
export const channelConversationMode = pgEnum("channel_conversation_mode", [
  "ai",
  "human",
  "ai_then_human",
  "human_then_ai",
  "keyword",
  "business_hours",
  "agent_failure",
  "user_request",
]);
export const channelConnectionStatus = pgEnum("channel_connection_status", [
  "pending",
  "healthy",
  "degraded",
  "disabled",
  "failed",
]);
export const channelEventStatus = pgEnum("channel_event_status", [
  "accepted",
  "processing",
  "completed",
  "failed",
  "ignored",
]);
export const channelHandoffStatus = pgEnum("channel_handoff_status", [
  "requested",
  "assigned",
  "resolved",
  "cancelled",
]);

export type ChannelConnectionSettings = {
  welcomeMessage?: string;
  autoReplyEnabled?: boolean;
  businessHours?: {
    timezone: string;
    days: Record<string, Array<{ start: string; end: string }>>;
  } | null;
  handoffMode?: (typeof channelConversationMode.enumValues)[number];
  escalationRules?: Array<Record<string, unknown>>;
  language?: string;
  memoryEnabled?: boolean;
  historyEnabled?: boolean;
  monthlyMessageLimit?: number;
  allowedCommands?: string[];
};

export type ChannelPermissionName =
  | "ai.chat"
  | "agent.use"
  | "tools.execute"
  | "account.read"
  | "conversation.open"
  | "tickets.create"
  | "orders.read"
  | "files.use"
  | "search.use"
  | "workflows.execute"
  | "handoff.request";

export const channelInboxes = pgTable("channel_inboxes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_inboxes_org_name_unique_idx").on(table.organizationId, table.name),
  index("channel_inboxes_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const channelInboxMembers = pgTable("channel_inbox_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboxId: uuid("inbox_id").notNull().references(() => channelInboxes.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_inbox_members_inbox_user_unique_idx").on(table.inboxId, table.userId),
  index("channel_inbox_members_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const channelWorkflows = pgTable("channel_workflows", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  trigger: text("trigger").notNull().default("incoming_message"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_workflows_org_name_unique_idx").on(table.organizationId, table.name),
  index("channel_workflows_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const channelConnections = pgTable("channel_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: channelKind("kind").notNull(),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  displayAddress: text("display_address"),
  credentialSource: text("credential_source").notNull().default("environment"),
  defaultAgentId: uuid("default_agent_id").references(() => agents.id, { onDelete: "set null" }),
  defaultProviderCredentialId: uuid("default_provider_credential_id").references(() => providerCredentials.id, { onDelete: "set null" }),
  defaultModel: text("default_model"),
  inboxId: uuid("inbox_id").references(() => channelInboxes.id, { onDelete: "set null" }),
  workflowId: uuid("workflow_id").references(() => channelWorkflows.id, { onDelete: "set null" }),
  settings: jsonb("settings").$type<ChannelConnectionSettings>().notNull().default({}),
  status: channelConnectionStatus("status").notNull().default("pending"),
  enabled: boolean("enabled").notNull().default(true),
  webhookStatus: text("webhook_status").notNull().default("unknown"),
  webhookLastVerifiedAt: timestamp("webhook_last_verified_at", { withTimezone: true }),
  lastHealthAt: timestamp("last_health_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_connections_org_kind_external_unique_idx").on(
    table.organizationId,
    table.kind,
    table.externalAccountId,
  ),
  index("channel_connections_org_kind_enabled_idx").on(table.organizationId, table.kind, table.enabled),
  index("channel_connections_agent_idx").on(table.defaultAgentId),
  index("channel_connections_provider_idx").on(table.defaultProviderCredentialId),
]);

export const channelAgentBindings = pgTable("channel_agent_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  providerCredentialId: uuid("provider_credential_id").references(() => providerCredentials.id, { onDelete: "set null" }),
  model: text("model"),
  priority: integer("priority").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_agent_bindings_connection_agent_unique_idx").on(table.connectionId, table.agentId),
  index("channel_agent_bindings_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const channelProviderBindings = pgTable("channel_provider_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  providerCredentialId: uuid("provider_credential_id").notNull().references(() => providerCredentials.id, { onDelete: "cascade" }),
  model: text("model"),
  priority: integer("priority").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_provider_bindings_connection_provider_unique_idx").on(
    table.connectionId,
    table.providerCredentialId,
  ),
  index("channel_provider_bindings_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const channelToolBindings = pgTable("channel_tool_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  toolId: uuid("tool_id").notNull().references(() => mcpTools.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_tool_bindings_connection_tool_unique_idx").on(table.connectionId, table.toolId),
  index("channel_tool_bindings_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const channelPermissions = pgTable("channel_permissions", {
  connectionId: uuid("connection_id").primaryKey().references(() => channelConnections.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  permissions: jsonb("permissions").$type<ChannelPermissionName[]>().notNull().default([]),
  blockedOperations: jsonb("blocked_operations").$type<string[]>().notNull().default(["financial", "sensitive"]),
  allowedCommands: jsonb("allowed_commands").$type<string[]>().notNull().default([]),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("channel_permissions_org_idx").on(table.organizationId)]);

export const channelRoutingRules = pgTable("channel_routing_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  conditionType: text("condition_type").notNull(),
  condition: jsonb("condition").$type<Record<string, unknown>>().notNull().default({}),
  action: text("action").notNull(),
  actionConfig: jsonb("action_config").$type<Record<string, unknown>>().notNull().default({}),
  priority: integer("priority").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_routing_rules_connection_name_unique_idx").on(table.connectionId, table.name),
  index("channel_routing_rules_connection_priority_idx").on(table.connectionId, table.enabled, table.priority),
]);

export const channelContacts = pgTable("channel_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: channelKind("kind").notNull(),
  externalId: text("external_id").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  displayName: text("display_name"),
  locale: text("locale"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_contacts_org_kind_external_unique_idx").on(table.organizationId, table.kind, table.externalId),
  index("channel_contacts_user_idx").on(table.userId),
]);

export const channelConversationLinks = pgTable("channel_conversation_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => channelContacts.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  mode: channelConversationMode("mode").notNull().default("ai"),
  inboxId: uuid("inbox_id").references(() => channelInboxes.id, { onDelete: "set null" }),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  lastExternalMessageId: text("last_external_message_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channel_conversation_links_connection_contact_unique_idx").on(table.connectionId, table.contactId),
  index("channel_conversation_links_org_status_idx").on(table.organizationId, table.status, table.lastMessageAt),
  index("channel_conversation_links_conversation_idx").on(table.conversationId),
]);

export const channelEvents = pgTable("channel_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  externalEventId: text("external_event_id").notNull(),
  direction: text("direction").notNull(),
  eventType: text("event_type").notNull(),
  status: channelEventStatus("status").notNull().default("accepted"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  errorCode: text("error_code"),
  retryCount: integer("retry_count").notNull().default(0),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("channel_events_connection_external_direction_unique_idx").on(
    table.connectionId,
    table.externalEventId,
    table.direction,
  ),
  index("channel_events_org_status_received_idx").on(table.organizationId, table.status, table.receivedAt),
]);

export const channelHandoffs = pgTable("channel_handoffs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => channelConnections.id, { onDelete: "cascade" }),
  conversationLinkId: uuid("conversation_link_id").notNull().references(() => channelConversationLinks.id, { onDelete: "cascade" }),
  fromMode: channelConversationMode("from_mode").notNull(),
  toMode: channelConversationMode("to_mode").notNull(),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull().default("system"),
  assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  status: channelHandoffStatus("status").notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  index("channel_handoffs_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  index("channel_handoffs_link_idx").on(table.conversationLinkId),
]);
