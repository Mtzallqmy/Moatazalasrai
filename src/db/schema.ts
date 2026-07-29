import {
  boolean,
  customType,
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

export const memberRole = pgEnum("member_role", ["owner", "admin", "developer", "operator", "viewer"]);
export const agentStatus = pgEnum("agent_status", ["draft", "published", "archived"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "completed", "failed", "cancelled"]);
export const providerKind = pgEnum("provider_kind", ["openai", "anthropic", "gemini", "openai_compatible"]);
export const providerValidationStatus = pgEnum("provider_validation_status", ["pending", "verified", "failed"]);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const integrationKind = pgEnum("integration_kind", ["telegram", "github"]);
export const integrationStatus = pgEnum("integration_status", ["pending", "verified", "failed"]);
export const attachmentSource = pgEnum("attachment_source", ["web", "api", "telegram"]);
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, { onDelete: "set null" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
  index("sessions_active_org_idx").on(table.activeOrganizationId),
  index("sessions_expires_at_idx").on(table.expiresAt),
]);

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("organization_members_org_user_idx").on(table.organizationId, table.userId),
  index("organization_members_org_role_idx").on(table.organizationId, table.role),
  index("organization_members_user_idx").on(table.userId),
]);

export const platformApiKeys = pgTable("platform_api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("platform_api_keys_org_idx").on(table.organizationId)]);

export const providerCredentials = pgTable("provider_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: providerKind("provider").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  secretHint: text("secret_hint").notNull(),
  discoveredModels: jsonb("discovered_models").$type<string[]>().notNull().default([]),
  validationStatus: providerValidationStatus("validation_status").notNull().default("pending"),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastValidationLatencyMs: integer("last_validation_latency_ms"),
  lastErrorCode: text("last_error_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("provider_credentials_org_idx").on(table.organizationId),
  index("provider_credentials_org_status_idx").on(table.organizationId, table.validationStatus, table.enabled),
]);

export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: agentStatus("status").notNull().default("draft"),
  currentVersion: integer("current_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("agents_org_status_idx").on(table.organizationId, table.status),
  index("agents_org_updated_idx").on(table.organizationId, table.updatedAt),
]);

export const agentVersions = pgTable("agent_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  providerCredentialId: uuid("provider_credential_id").notNull().references(() => providerCredentials.id),
  model: text("model").notNull(),
  instructions: text("instructions").notNull(),
  temperatureMilli: integer("temperature_milli").notNull().default(200),
  maxOutputTokens: integer("max_output_tokens").notNull().default(2048),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_versions_agent_version_idx").on(table.agentId, table.version),
  index("agent_versions_provider_idx").on(table.providerCredentialId),
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  title: text("title"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("conversations_org_updated_idx").on(table.organizationId, table.updatedAt),
  index("conversations_org_archived_idx").on(table.organizationId, table.archivedAt),
  index("conversations_agent_idx").on(table.agentId),
]);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRole("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)]);

export const runs = pgTable("runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  agentVersionId: uuid("agent_version_id").notNull().references(() => agentVersions.id),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  status: runStatus("status").notNull().default("queued"),
  requestId: text("request_id").notNull(),
  providerRequestId: text("provider_request_id"),
  input: text("input").notNull(),
  output: text("output"),
  error: text("error"),
  errorCode: text("error_code"),
  provider: providerKind("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("runs_org_created_idx").on(table.organizationId, table.createdAt),
  index("runs_org_status_idx").on(table.organizationId, table.status),
  index("runs_conversation_idx").on(table.conversationId),
  index("runs_agent_idx").on(table.agentId),
  index("runs_request_idx").on(table.requestId),
]);

export const runEvents = pgTable("run_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("run_events_run_sequence_unique_idx").on(table.runId, table.sequence),
  index("run_events_run_created_idx").on(table.runId, table.createdAt),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_logs_org_created_idx").on(table.organizationId, table.createdAt),
  index("audit_logs_actor_idx").on(table.actorId),
]);

export const rateLimits = pgTable("rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("rate_limits_scope_key_window_idx").on(table.scope, table.keyHash, table.windowStartedAt),
  index("rate_limits_expires_idx").on(table.expiresAt),
]);

export const integrations = pgTable("integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: integrationKind("kind").notNull(),
  name: text("name").notNull(),
  encryptedToken: text("encrypted_token").notNull(),
  tokenHint: text("token_hint").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  status: integrationStatus("status").notNull().default("pending"),
  enabled: boolean("enabled").notNull().default(true),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("integrations_org_kind_name_unique_idx").on(table.organizationId, table.kind, table.name),
  index("integrations_org_kind_status_idx").on(table.organizationId, table.kind, table.status, table.enabled),
]);

export const telegramChats = pgTable("telegram_chats", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  telegramChatId: text("telegram_chat_id").notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  username: text("username"),
  title: text("title"),
  enabled: boolean("enabled").notNull().default(true),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("telegram_chats_integration_chat_unique_idx").on(table.integrationId, table.telegramChatId),
  index("telegram_chats_org_updated_idx").on(table.organizationId, table.updatedAt),
]);

export const telegramUpdates = pgTable("telegram_updates", {
  id: uuid("id").defaultRandom().primaryKey(),
  integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  updateId: text("update_id").notNull(),
  status: text("status").notNull().default("accepted"),
  errorCode: text("error_code"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("telegram_updates_integration_update_unique_idx").on(table.integrationId, table.updateId),
  index("telegram_updates_received_idx").on(table.receivedAt),
]);

export const attachments = pgTable("attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  source: attachmentSource("source").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  content: bytea("content").notNull(),
  telegramFileId: text("telegram_file_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("attachments_org_created_idx").on(table.organizationId, table.createdAt),
  index("attachments_conversation_idx").on(table.conversationId, table.createdAt),
  index("attachments_message_idx").on(table.messageId),
  index("attachments_sha256_idx").on(table.organizationId, table.sha256),
]);

export type Agent = typeof agents.$inferSelect;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
