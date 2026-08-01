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
import { sql } from "drizzle-orm";

export const memberRole = pgEnum("member_role", ["owner", "admin", "developer", "operator", "viewer", "member"]);
export const agentStatus = pgEnum("agent_status", ["draft", "published", "archived"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]);
export const providerKind = pgEnum("provider_kind", ["openai", "anthropic", "gemini", "openai_compatible"]);
export const providerValidationStatus = pgEnum("provider_validation_status", ["pending", "verified", "failed"]);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const integrationKind = pgEnum("integration_kind", ["telegram", "github"]);
export const integrationStatus = pgEnum("integration_status", ["pending", "verified", "failed"]);
export const attachmentSource = pgEnum("attachment_source", ["web", "api", "telegram"]);
export const fileProcessingStatus = pgEnum("file_processing_status", ["pending", "processing", "ready", "failed", "quarantined"]);
export const memoryKind = pgEnum("memory_kind", ["semantic", "procedural", "episodic"]);
export const documentStatus = pgEnum("document_status", ["uploaded", "processing", "ready", "failed", "deleted"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "completed", "failed", "cancelled"]);
export const toolApprovalStatus = pgEnum("tool_approval_status", ["pending", "approved", "rejected", "consumed", "expired"]);
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  defaultProviderCredentialId: uuid("default_provider_credential_id"),
  defaultModel: text("default_model"),
  publicRegistrationEnabled: boolean("public_registration_enabled").notNull().default(false),
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

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  chatTheme: text("chat_theme").notNull().default("moataz"),
  chatWallpaper: text("chat_wallpaper").notNull().default("soft-grid"),
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
  role: memberRole("role").notNull().default("member"),
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
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revoked: boolean("revoked").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("platform_api_keys_org_idx").on(table.organizationId)]);

export const mobileSessions = pgTable("mobile_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accessTokenHash: text("access_token_hash").notNull().unique(),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mobile_sessions_user_device_idx").on(table.userId, table.deviceId),
  index("mobile_sessions_access_expiry_idx").on(table.accessExpiresAt),
  index("mobile_sessions_refresh_expiry_idx").on(table.refreshExpiresAt),
]);

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
  defaultProviderCredentialId: uuid("default_provider_credential_id"),
  defaultModel: text("default_model"),
}, (table) => [
  index("agents_org_status_idx").on(table.organizationId, table.status),
  index("agents_org_updated_idx").on(table.organizationId, table.updatedAt),
]);

export const conversationFolders = pgTable("conversation_folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("conversation_folders_org_updated_idx").on(table.organizationId, table.updatedAt)]);

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
  folderId: uuid("folder_id"),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  parentMessageId: uuid("parent_message_id"),
  clientRequestId: text("client_request_id"),
  providerCredentialId: uuid("provider_credential_id"),
  model: text("model"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  content: bytea("content"),
  storageDriver: text("storage_driver").notNull().default("database"),
  objectKey: text("object_key"),
  telegramFileId: text("telegram_file_id"),
  detectedType: text("detected_type"),
  processingStatus: fileProcessingStatus("processing_status").notNull().default("pending"),
  extractedText: text("extracted_text"),
  processingErrorCode: text("processing_error_code"),
  archiveEntryCount: integer("archive_entry_count"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("attachments_org_created_idx").on(table.organizationId, table.createdAt),
  index("attachments_conversation_idx").on(table.conversationId, table.createdAt),
  index("attachments_message_idx").on(table.messageId),
  index("attachments_sha256_idx").on(table.organizationId, table.sha256),
  uniqueIndex("attachments_storage_object_idx").on(table.storageDriver, table.objectKey).where(sql`${table.objectKey} IS NOT NULL`),
]);

export const turnstileVerifications = pgTable("turnstile_verifications", {
  tokenHash: text("token_hash").primaryKey(),
  action: text("action").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("turnstile_verifications_expires_idx").on(table.expiresAt)]);

export const modelCatalog = pgTable("model_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerCredentialId: uuid("provider_credential_id").notNull().references(() => providerCredentials.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  capabilities: jsonb("capabilities").$type<{
    text?: boolean;
    vision?: boolean;
    files?: boolean;
    tools?: boolean;
    structuredOutput?: boolean;
    streaming?: boolean;
    audio?: boolean;
    coding?: boolean;
  }>().notNull().default({}),
  contextWindow: integer("context_window"),
  maxOutputTokens: integer("max_output_tokens"),
  freeTierEligible: boolean("free_tier_eligible").notNull().default(false),
  available: boolean("available").notNull().default(true),
  latencyMs: integer("latency_ms"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("model_catalog_provider_model_unique_idx").on(table.providerCredentialId, table.model),
  index("model_catalog_org_available_idx").on(table.organizationId, table.available, table.freeTierEligible),
]);

export const agentMemories = pgTable("agent_memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  kind: memoryKind("kind").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  importanceMilli: integer("importance_milli").notNull().default(500),
  enabled: boolean("enabled").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("agent_memories_scope_idx").on(table.organizationId, table.userId, table.agentId, table.enabled)]);

export const knowledgeBases = pgTable("knowledge_bases", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("knowledge_bases_org_name_unique").on(table.organizationId, table.name)]);

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
  title: text("title").notNull(), mimeType: text("mime_type").notNull(), byteSize: integer("byte_size").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  status: documentStatus("status").notNull().default("uploaded"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("knowledge_documents_org_kb_checksum_unique").on(table.organizationId, table.knowledgeBaseId, table.checksumSha256),
  index("knowledge_documents_scope_idx").on(table.organizationId, table.knowledgeBaseId, table.status),
]);

export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(), content: text("content").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("knowledge_chunks_doc_index_unique").on(table.documentId, table.chunkIndex),
  index("knowledge_chunks_scope_idx").on(table.organizationId, table.documentId),
]);

export const backgroundJobs = pgTable("background_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type").notNull(), status: jobStatus("status").notNull().default("queued"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(5),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }), lockedBy: text("locked_by"),
  lastErrorCode: text("last_error_code"), completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("background_jobs_claim_idx").on(table.status, table.availableAt, table.lockedAt),
  index("background_jobs_scope_idx").on(table.organizationId, table.createdAt),
]);

export const toolApprovals = pgTable("tool_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull(), inputDigest: text("input_digest").notNull(),
  status: toolApprovalStatus("status").notNull().default("pending"),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("tool_approvals_scope_idx").on(table.organizationId, table.status, table.expiresAt)]);

export const mcpServers = pgTable("mcp_servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  endpoint: text("endpoint").notNull(),
  transport: text("transport").notNull().default("streamable_http"),
  authMode: text("auth_mode").notNull().default("bearer"),
  encryptedBearerToken: text("encrypted_bearer_token"),
  tokenHint: text("token_hint"),
  encryptedOauthData: text("encrypted_oauth_data"),
  oauthScopes: text("oauth_scopes"),
  oauthExpiresAt: timestamp("oauth_expires_at", { withTimezone: true }),
  oauthConnectedAt: timestamp("oauth_connected_at", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("pending"),
  protocolVersion: text("protocol_version"),
  serverName: text("server_name"),
  serverVersion: text("server_version"),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mcp_servers_org_name_idx").on(table.organizationId, table.name),
  index("mcp_servers_org_status_idx").on(table.organizationId, table.status, table.enabled),
]);

export const mcpTools = pgTable("mcp_tools", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  serverId: uuid("server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  title: text("title"),
  description: text("description"),
  inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().notNull().default({}),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
  annotations: jsonb("annotations").$type<Record<string, unknown>>().notNull().default({}),
  schemaHash: text("schema_hash").notNull(),
  capability: text("capability").notNull().default("general"),
  mediaType: text("media_type"),
  enabled: boolean("enabled").notNull().default(true),
  risk: text("risk").notNull().default("medium"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mcp_tools_server_name_idx").on(table.serverId, table.name),
  index("mcp_tools_org_enabled_idx").on(table.organizationId, table.enabled),
  index("mcp_tools_org_capability_idx").on(table.organizationId, table.capability, table.enabled),
]);

export const agentMcpTools = pgTable("agent_mcp_tools", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  toolId: uuid("tool_id").notNull().references(() => mcpTools.id, { onDelete: "cascade" }),
  approvalMode: text("approval_mode").notNull().default("risk_based"),
  maxCallsPerRun: integer("max_calls_per_run").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_mcp_tools_agent_tool_idx").on(table.agentId, table.toolId),
  index("agent_mcp_tools_org_idx").on(table.organizationId),
]);

export const mcpToolCalls = pgTable("mcp_tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  serverId: uuid("server_id").notNull().references(() => mcpServers.id),
  toolId: uuid("tool_id").notNull().references(() => mcpTools.id),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  inputDigest: text("input_digest").notNull(),
  status: text("status").notNull().default("running"),
  durationMs: integer("duration_ms"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("mcp_tool_calls_org_created_idx").on(table.organizationId, table.createdAt),
  index("mcp_tool_calls_run_idx").on(table.runId),
]);

export const agentTeams = pgTable("agent_teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  supervisorAgentId: uuid("supervisor_agent_id").notNull().references(() => agents.id),
  enabled: boolean("enabled").notNull().default(true),
  maxParallelWorkers: integer("max_parallel_workers").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_teams_org_name_idx").on(table.organizationId, table.name),
  index("agent_teams_org_enabled_idx").on(table.organizationId, table.enabled),
]);

export const agentTeamMembers = pgTable("agent_team_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => agentTeams.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  role: text("role").notNull().default("worker"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_team_members_team_agent_idx").on(table.teamId, table.agentId),
  index("agent_team_members_org_idx").on(table.organizationId),
]);

export const agentTeamRuns = pgTable("agent_team_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => agentTeams.id),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestId: text("request_id").notNull(),
  input: text("input").notNull(),
  output: text("output"),
  status: text("status").notNull().default("queued"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("agent_team_runs_org_request_idx").on(table.organizationId, table.requestId),
  index("agent_team_runs_org_created_idx").on(table.organizationId, table.createdAt),
]);

export const agentTeamRunSteps = pgTable("agent_team_run_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  teamRunId: uuid("team_run_id").notNull().references(() => agentTeamRuns.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  stepType: text("step_type").notNull(),
  position: integer("position").notNull(),
  status: text("status").notNull().default("queued"),
  output: text("output"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("agent_team_run_steps_run_idx").on(table.teamRunId, table.position),
  index("agent_team_run_steps_org_idx").on(table.organizationId),
]);

export type Agent = typeof agents.$inferSelect;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
