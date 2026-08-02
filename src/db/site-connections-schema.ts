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
import { sql } from "drizzle-orm";
import { agents, organizations, users } from "@/db/schema";

export const siteConnectorType = pgEnum("site_connector_type", ["oauth", "api", "browser"]);
export const siteConnectionStatus = pgEnum("site_connection_status", [
  "pending",
  "verified",
  "expired",
  "revoked",
  "failed",
]);
export const sitePermissionAction = pgEnum("site_permission_action", [
  "read",
  "search",
  "navigate",
  "fill_form",
  "create",
  "update",
  "upload",
  "download",
  "send",
  "publish",
  "delete",
  "invite_users",
  "purchase",
  "payment",
  "account_settings",
  "security_settings",
]);
export const sitePermissionPolicy = pgEnum("site_permission_policy", [
  "allow",
  "require_approval",
  "deny",
]);
export const browserTaskStatus = pgEnum("browser_task_status", [
  "queued",
  "planning",
  "awaiting_connection",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
export const browserRiskLevel = pgEnum("browser_risk_level", ["low", "medium", "high", "critical"]);
export const browserTaskStepStatus = pgEnum("browser_task_step_status", [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

export const siteConnections = pgTable("site_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  siteDomain: text("site_domain").notNull(),
  connectorType: siteConnectorType("connector_type").notNull(),
  connectorKey: text("connector_key").notNull(),
  status: siteConnectionStatus("status").notNull().default("pending"),
  encryptedCredentials: text("encrypted_credentials"),
  encryptedSessionState: text("encrypted_session_state"),
  credentialKeyId: text("credential_key_id"),
  credentialHint: text("credential_hint"),
  grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
  allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_connections_org_name_unique_idx").on(table.organizationId, table.name),
  uniqueIndex("site_connections_org_id_unique_idx").on(table.organizationId, table.id),
  index("site_connections_org_status_idx").on(table.organizationId, table.status, table.updatedAt),
  index("site_connections_connector_idx").on(table.connectorKey, table.connectorType),
]);

export const agentSiteConnections = pgTable("agent_site_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  siteConnectionId: uuid("site_connection_id").notNull().references(() => siteConnections.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_site_connections_agent_connection_unique_idx").on(table.agentId, table.siteConnectionId),
  uniqueIndex("agent_site_connections_org_id_unique_idx").on(table.organizationId, table.id),
  index("agent_site_connections_org_agent_idx").on(table.organizationId, table.agentId, table.enabled),
  index("agent_site_connections_org_connection_idx").on(table.organizationId, table.siteConnectionId, table.enabled),
]);

export const siteConnectionPermissions = pgTable("site_connection_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentSiteConnectionId: uuid("agent_site_connection_id").notNull()
    .references(() => agentSiteConnections.id, { onDelete: "cascade" }),
  action: sitePermissionAction("action").notNull(),
  policy: sitePermissionPolicy("policy").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("site_connection_permissions_assignment_action_unique_idx")
    .on(table.agentSiteConnectionId, table.action),
  index("site_connection_permissions_org_assignment_idx")
    .on(table.organizationId, table.agentSiteConnectionId),
]);

export const browserTasks = pgTable("browser_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  siteConnectionId: uuid("site_connection_id").notNull().references(() => siteConnections.id),
  instruction: text("instruction").notNull(),
  status: browserTaskStatus("status").notNull().default("queued"),
  riskLevel: browserRiskLevel("risk_level").notNull().default("low"),
  plan: jsonb("plan").$type<Record<string, unknown>>(),
  currentStep: integer("current_step").notNull().default(0),
  idempotencyKey: text("idempotency_key"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("browser_tasks_org_idempotency_unique_idx")
    .on(table.organizationId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  uniqueIndex("browser_tasks_org_id_unique_idx").on(table.organizationId, table.id),
  index("browser_tasks_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  index("browser_tasks_connection_idx").on(table.siteConnectionId, table.createdAt),
  index("browser_tasks_agent_idx").on(table.organizationId, table.agentId, table.createdAt),
]);

export const browserTaskSteps = pgTable("browser_task_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  browserTaskId: uuid("browser_task_id").notNull().references(() => browserTasks.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  action: text("action").notNull(),
  target: jsonb("target").$type<Record<string, unknown>>().notNull().default({}),
  inputRedacted: jsonb("input_redacted").$type<Record<string, unknown>>(),
  requiredPermission: sitePermissionAction("required_permission").notNull(),
  riskLevel: browserRiskLevel("risk_level").notNull(),
  status: browserTaskStepStatus("status").notNull().default("queued"),
  expectedResult: text("expected_result"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  screenshotObjectKey: text("screenshot_object_key"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("browser_task_steps_task_sequence_unique_idx").on(table.browserTaskId, table.sequence),
  uniqueIndex("browser_task_steps_org_id_unique_idx").on(table.organizationId, table.id),
  index("browser_task_steps_org_task_idx").on(table.organizationId, table.browserTaskId, table.sequence),
  index("browser_task_steps_status_idx").on(table.status, table.createdAt),
]);
