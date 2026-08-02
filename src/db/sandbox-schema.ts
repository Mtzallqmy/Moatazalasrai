import { sql } from "drizzle-orm";
import {
  bigint,
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
import { agents, conversations, messages, organizations, users } from "@/db/schema";

export const sandboxWorkspaceStatus = pgEnum("sandbox_workspace_status", [
  "provisioning",
  "ready",
  "paused",
  "resetting",
  "failed",
  "terminated",
]);
export const sandboxExecutionStatus = pgEnum("sandbox_execution_status", [
  "queued",
  "awaiting_approval",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
export const sandboxPermissionAction = pgEnum("sandbox_permission_action", [
  "create",
  "exec",
  "read_file",
  "write_file",
  "delete_file",
  "list_files",
  "upload_file",
  "download_artifact",
  "stop_execution",
  "reset",
  "network",
]);
export const sandboxPermissionPolicy = pgEnum("sandbox_permission_policy", [
  "allow",
  "require_approval",
  "deny",
]);
export const sandboxRiskLevel = pgEnum("sandbox_risk_level", ["low", "medium", "high", "critical"]);
export const sandboxArtifactStatus = pgEnum("sandbox_artifact_status", [
  "pending",
  "ready",
  "deleted",
  "expired",
]);

export const sandboxWorkspaces = pgTable("sandbox_workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  provider: text("provider").notNull().default("isolated_runner"),
  externalWorkspaceId: text("external_workspace_id"),
  template: text("template").notNull().default("moataz-code"),
  status: sandboxWorkspaceStatus("status").notNull().default("provisioning"),
  networkMode: text("network_mode").notNull().default("disabled"),
  diskLimitBytes: bigint("disk_limit_bytes", { mode: "number" }).notNull(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sandbox_workspaces_org_id_unique_idx").on(table.organizationId, table.id),
  index("sandbox_workspaces_org_status_idx").on(table.organizationId, table.status, table.updatedAt),
  index("sandbox_workspaces_expiry_idx").on(table.expiresAt),
]);

export const conversationSandboxWorkspaces = pgTable("conversation_sandbox_workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => sandboxWorkspaces.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("conversation_sandbox_workspaces_pair_unique_idx").on(table.conversationId, table.workspaceId),
  uniqueIndex("conversation_sandbox_workspaces_active_unique_idx")
    .on(table.organizationId, table.conversationId)
    .where(sql`${table.active} = true`),
  index("conversation_sandbox_workspaces_org_idx").on(table.organizationId, table.conversationId, table.active),
]);

export const sandboxPermissions = pgTable("sandbox_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => sandboxWorkspaces.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  action: sandboxPermissionAction("action").notNull(),
  policy: sandboxPermissionPolicy("policy").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sandbox_permissions_workspace_agent_action_unique_idx")
    .on(table.workspaceId, table.agentId, table.action),
  index("sandbox_permissions_org_agent_idx").on(table.organizationId, table.agentId, table.workspaceId),
]);

export const sandboxExecutions = pgTable("sandbox_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => sandboxWorkspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  encryptedCommand: text("encrypted_command").notNull(),
  commandSummary: text("command_summary").notNull(),
  workingDirectory: text("working_directory").notNull().default("."),
  status: sandboxExecutionStatus("status").notNull().default("queued"),
  riskLevel: sandboxRiskLevel("risk_level").notNull().default("low"),
  policyDecision: jsonb("policy_decision").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key").notNull(),
  externalExecutionId: text("external_execution_id"),
  timeoutMs: integer("timeout_ms").notNull(),
  exitCode: integer("exit_code"),
  stdoutBytes: integer("stdout_bytes").notNull().default(0),
  stderrBytes: integer("stderr_bytes").notNull().default(0),
  outputTruncated: boolean("output_truncated").notNull().default(false),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sandbox_executions_org_id_unique_idx").on(table.organizationId, table.id),
  uniqueIndex("sandbox_executions_org_idempotency_unique_idx").on(table.organizationId, table.idempotencyKey),
  index("sandbox_executions_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  index("sandbox_executions_workspace_idx").on(table.workspaceId, table.createdAt),
  index("sandbox_executions_conversation_idx").on(table.organizationId, table.conversationId, table.createdAt),
]);

export const sandboxEvents = pgTable("sandbox_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").notNull().references(() => sandboxExecutions.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  stream: text("stream"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sandbox_events_execution_sequence_unique_idx").on(table.executionId, table.sequence),
  index("sandbox_events_org_execution_idx").on(table.organizationId, table.executionId, table.sequence),
]);

export const sandboxFiles = pgTable("sandbox_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => sandboxWorkspaces.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  sha256: text("sha256"),
  isDirectory: boolean("is_directory").notNull().default(false),
  modifiedAt: timestamp("modified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sandbox_files_workspace_path_unique_idx").on(table.workspaceId, table.path),
  index("sandbox_files_org_workspace_idx").on(table.organizationId, table.workspaceId, table.path),
]);

export const sandboxArtifacts = pgTable("sandbox_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => sandboxWorkspaces.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").references(() => sandboxExecutions.id, { onDelete: "set null" }),
  fileId: uuid("file_id").references(() => sandboxFiles.id, { onDelete: "set null" }),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  status: sandboxArtifactStatus("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sandbox_artifacts_object_key_unique_idx").on(table.objectKey),
  index("sandbox_artifacts_org_expiry_idx").on(table.organizationId, table.status, table.expiresAt),
  index("sandbox_artifacts_workspace_idx").on(table.workspaceId, table.createdAt),
]);
