import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organizations, providerCredentials, users } from "./schema";

export const executionRunnerKind = pgEnum("execution_runner_kind", [
  "existing",
  "gvisor",
  "e2b",
  "daytona",
]);

export const executionWorkspaceState = pgEnum("execution_workspace_state", [
  "provisioning",
  "ready",
  "running",
  "paused",
  "stopping",
  "stopped",
  "failed",
]);

export const executionJobStatus = pgEnum("execution_job_status", [
  "queued",
  "provisioning",
  "ready",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "cancel_requested",
  "cancelling",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
]);

export const executionWorkspaces = pgTable("execution_workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  runnerKind: executionRunnerKind("runner_kind").notNull(),
  externalWorkspaceId: text("external_workspace_id"),
  templateId: text("template_id").notNull(),
  state: executionWorkspaceState("state").notNull().default("provisioning"),
  networkPolicy: jsonb("network_policy").$type<Record<string, unknown>>().notNull().default({}),
  limits: jsonb("limits").$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_workspaces_org_id_unique_idx").on(table.organizationId, table.id),
  index("execution_workspaces_org_state_idx").on(table.organizationId, table.state, table.updatedAt),
  index("execution_workspaces_user_idx").on(table.organizationId, table.userId, table.createdAt),
  index("execution_workspaces_expiry_idx").on(table.expiresAt, table.state),
]);

export const executionJobs = pgTable("execution_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => executionWorkspaces.id, { onDelete: "restrict" }),
  parentJobId: uuid("parent_job_id").references((): AnyPgColumn => executionJobs.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  status: executionJobStatus("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  requestedInput: jsonb("requested_input").$type<Record<string, unknown>>().notNull().default({}),
  normalizedInput: jsonb("normalized_input").$type<Record<string, unknown>>().notNull().default({}),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown>>().notNull().default({}),
  errorCode: text("error_code"),
  errorReference: text("error_reference"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_jobs_org_idempotency_unique_idx").on(table.organizationId, table.idempotencyKey),
  uniqueIndex("execution_jobs_org_id_unique_idx").on(table.organizationId, table.id),
  index("execution_jobs_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  index("execution_jobs_user_status_idx").on(table.organizationId, table.userId, table.status, table.createdAt),
  index("execution_jobs_expiry_idx").on(table.expiresAt, table.status),
  index("execution_jobs_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const executionSteps = pgTable("execution_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"),
  commandSpec: jsonb("command_spec").$type<Record<string, unknown>>().notNull().default({}),
  inputSummary: jsonb("input_summary").$type<Record<string, unknown>>().notNull().default({}),
  outputSummary: jsonb("output_summary").$type<Record<string, unknown>>().notNull().default({}),
  exitCode: integer("exit_code"),
  signal: text("signal"),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_steps_job_sequence_unique_idx").on(table.jobId, table.sequence),
  index("execution_steps_job_status_idx").on(table.jobId, table.status, table.sequence),
]);

export const executionEvents = pgTable("execution_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobId: uuid("job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  level: text("level").notNull().default("info"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_events_job_sequence_unique_idx").on(table.jobId, table.sequence),
  index("execution_events_job_created_idx").on(table.jobId, table.createdAt),
]);

export const executionArtifacts = pgTable("execution_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => executionSteps.id, { onDelete: "set null" }),
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  kind: text("kind").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_artifacts_storage_key_unique_idx").on(table.storageKey),
  index("execution_artifacts_org_job_idx").on(table.organizationId, table.jobId, table.createdAt),
  index("execution_artifacts_retention_idx").on(table.retentionUntil),
]);

export const executionLeases = pgTable("execution_leases", {
  jobId: uuid("job_id").primaryKey().references(() => executionJobs.id, { onDelete: "cascade" }),
  workerId: text("worker_id").notNull(),
  leaseTokenHash: text("lease_token_hash").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).defaultNow().notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("execution_leases_expiry_idx").on(table.expiresAt),
  index("execution_leases_worker_idx").on(table.workerId, table.expiresAt),
]);

export const executionCredentialGrants = pgTable("execution_credential_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  credentialId: uuid("credential_id").notNull().references(() => providerCredentials.id, { onDelete: "cascade" }),
  providerKind: text("provider_kind").notNull(),
  allowedHosts: jsonb("allowed_hosts").$type<string[]>().notNull().default([]),
  allowedOperations: jsonb("allowed_operations").$type<string[]>().notNull().default([]),
  budget: jsonb("budget").$type<Record<string, unknown>>().notNull().default({}),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_credential_grants_token_hash_unique_idx").on(table.tokenHash),
  index("execution_credential_grants_job_idx").on(table.organizationId, table.jobId, table.expiresAt),
  index("execution_credential_grants_expiry_idx").on(table.expiresAt, table.revokedAt),
]);

export const executionUsage = pgTable("execution_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  cpuMilliseconds: bigint("cpu_milliseconds", { mode: "number" }).notNull().default(0),
  memoryPeakBytes: bigint("memory_peak_bytes", { mode: "number" }).notNull().default(0),
  diskPeakBytes: bigint("disk_peak_bytes", { mode: "number" }).notNull().default(0),
  networkIngressBytes: bigint("network_ingress_bytes", { mode: "number" }).notNull().default(0),
  networkEgressBytes: bigint("network_egress_bytes", { mode: "number" }).notNull().default(0),
  stdoutBytes: bigint("stdout_bytes", { mode: "number" }).notNull().default(0),
  stderrBytes: bigint("stderr_bytes", { mode: "number" }).notNull().default(0),
  artifactBytes: bigint("artifact_bytes", { mode: "number" }).notNull().default(0),
  aiInputTokens: bigint("ai_input_tokens", { mode: "number" }).notNull().default(0),
  aiOutputTokens: bigint("ai_output_tokens", { mode: "number" }).notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 18, scale: 8 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_usage_job_unique_idx").on(table.jobId),
  index("execution_usage_org_user_idx").on(table.organizationId, table.userId, table.createdAt),
]);
