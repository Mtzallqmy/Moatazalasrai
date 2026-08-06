import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  agents,
  conversations,
  organizations,
  providerCredentials,
  users,
} from "@/db/schema";
import { channelInboxes, channelWorkflows } from "@/db/channel-schema";

export type WhatsAppPolicyPermissions = string[];

export const platformWhatsAppEndpoints = pgTable("platform_whatsapp_endpoints", {
  id: text("id").primaryKey().default("primary"),
  phoneNumberId: text("phone_number_id").notNull(),
  businessAccountId: text("business_account_id").notNull(),
  displayPhoneNumber: text("display_phone_number").notNull(),
  credentialSource: text("credential_source").notNull().default("environment"),
  configurationFingerprint: text("configuration_fingerprint").notNull(),
  defaultOrganizationId: uuid("default_organization_id").references(() => organizations.id, { onDelete: "set null" }),
  status: text("status").notNull().default("healthy"),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("platform_whatsapp_endpoint_phone_unique_idx").on(table.phoneNumberId),
  index("platform_whatsapp_endpoint_status_idx").on(table.status, table.updatedAt),
]);

export const platformWhatsAppDefaults = pgTable("platform_whatsapp_defaults", {
  id: text("id").primaryKey().default("primary"),
  defaultAgentId: uuid("default_agent_id").references(() => agents.id, { onDelete: "set null" }),
  defaultProviderCredentialId: uuid("default_provider_credential_id").references(() => providerCredentials.id, { onDelete: "set null" }),
  defaultModel: text("default_model"),
  defaultPermissions: jsonb("default_permissions").$type<WhatsAppPolicyPermissions>().notNull().default(["ai.chat", "agent.use", "conversation.open"]),
  defaultAllowedTools: jsonb("default_allowed_tools").$type<string[]>().notNull().default([]),
  defaultAllowedActions: jsonb("default_allowed_actions").$type<string[]>().notNull().default([]),
  monthlyLimit: integer("monthly_limit"),
  autoReplyEnabled: boolean("auto_reply_enabled").notNull().default(true),
  humanHandoffEnabled: boolean("human_handoff_enabled").notNull().default(true),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  filesEnabled: boolean("files_enabled").notNull().default(true),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const whatsappOrganizationPolicies = pgTable("whatsapp_organization_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  providerCredentialId: uuid("provider_credential_id").references(() => providerCredentials.id, { onDelete: "set null" }),
  modelId: text("model_id"),
  teamId: uuid("team_id"),
  inboxId: uuid("inbox_id").references(() => channelInboxes.id, { onDelete: "set null" }),
  workflowId: uuid("workflow_id").references(() => channelWorkflows.id, { onDelete: "set null" }),
  allowedTools: jsonb("allowed_tools").$type<string[]>().notNull().default([]),
  allowedActions: jsonb("allowed_actions").$type<string[]>().notNull().default([]),
  permissions: jsonb("permissions").$type<WhatsAppPolicyPermissions>().notNull().default([]),
  monthlyLimit: integer("monthly_limit"),
  autoReplyEnabled: boolean("auto_reply_enabled"),
  humanHandoffEnabled: boolean("human_handoff_enabled"),
  memoryEnabled: boolean("memory_enabled"),
  filesEnabled: boolean("files_enabled"),
  status: text("status").notNull().default("active"),
  forceHumanHandoff: boolean("force_human_handoff").notNull().default(false),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("whatsapp_org_policy_org_unique_idx").on(table.organizationId),
  index("whatsapp_org_policy_status_idx").on(table.organizationId, table.status),
]);

export const whatsappUserPolicies = pgTable("whatsapp_user_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  providerCredentialId: uuid("provider_credential_id").references(() => providerCredentials.id, { onDelete: "set null" }),
  modelId: text("model_id"),
  teamId: uuid("team_id"),
  inboxId: uuid("inbox_id").references(() => channelInboxes.id, { onDelete: "set null" }),
  workflowId: uuid("workflow_id").references(() => channelWorkflows.id, { onDelete: "set null" }),
  allowedTools: jsonb("allowed_tools").$type<string[]>().notNull().default([]),
  allowedActions: jsonb("allowed_actions").$type<string[]>().notNull().default([]),
  permissions: jsonb("permissions").$type<WhatsAppPolicyPermissions>().notNull().default([]),
  monthlyLimit: integer("monthly_limit"),
  autoReplyEnabled: boolean("auto_reply_enabled"),
  humanHandoffEnabled: boolean("human_handoff_enabled"),
  memoryEnabled: boolean("memory_enabled"),
  filesEnabled: boolean("files_enabled"),
  status: text("status").notNull().default("active"),
  forceHumanHandoff: boolean("force_human_handoff").notNull().default(false),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("whatsapp_user_policy_org_user_unique_idx").on(table.organizationId, table.userId),
  index("whatsapp_user_policy_status_idx").on(table.organizationId, table.status, table.updatedAt),
  index("whatsapp_user_policy_user_idx").on(table.userId),
  index("whatsapp_user_policy_force_handoff_idx").on(table.organizationId, table.forceHumanHandoff)
    .where(sql`${table.forceHumanHandoff} = true`),
]);

export const whatsappUserSessions = pgTable("whatsapp_user_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  whatsappWaId: text("whatsapp_wa_id").notNull(),
  activeFlow: text("active_flow"),
  currentStep: text("current_step"),
  selectedAgentId: uuid("selected_agent_id").references(() => agents.id, { onDelete: "set null" }),
  selectedTeamId: uuid("selected_team_id"),
  selectedConversationId: uuid("selected_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("whatsapp_user_sessions_identity_unique_idx").on(table.userId, table.organizationId, table.whatsappWaId),
  index("whatsapp_user_sessions_active_flow_idx").on(table.organizationId, table.activeFlow, table.expiresAt),
  index("whatsapp_user_sessions_conversation_idx").on(table.organizationId, table.selectedConversationId)
    .where(sql`${table.selectedConversationId} IS NOT NULL`),
]);
