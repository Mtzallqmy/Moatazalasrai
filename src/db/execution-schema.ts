import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { attachments, organizations, users } from "@/db/schema";

export type ExecutionNetworkPolicy = {
  mode: "deny_all" | "allowlist";
  hosts: string[];
};

export type ExecutionLimits = {
  timeoutMs: number;
  memoryBytes: number;
  diskBytes: number;
  maxArtifactBytes: number;
  maxOutputBytes: number;
};

export const executionWorkspaces = pgTable("execution_workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  runnerKind: text("runner_kind").notNull(),
  template: text("template").notNull(),
  status: text("status").notNull().default("provisioning"),
  externalWorkspaceRef: text("external_workspace_ref"),
  networkPolicy: jsonb("network_policy").$type<ExecutionNetworkPolicy>().notNull().default({ mode: "deny_all", hosts: [] }),
  limits: jsonb("limits").$type<ExecutionLimits>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_workspaces_org_id_unique_idx").on(table.organizationId, table.id),
  index("execution_workspaces_org_status_idx").on(table.organizationId, table.status, table.updatedAt),
  index("execution_workspaces_expiry_idx").on(table.expiresAt),
]);

export const executionJobs = pgTable("execution_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  workspaceId: uuid("workspace_id").references(() => executionWorkspaces.id, { onDelete: "set null" }),
  executionKind: text("execution_kind").notNull(),
  runnerKind: text("runner_kind").notNull(),
  status: text("status").notNull().default("queued"),
  title: text("title"),
  idempotencyKey: text("idempotency_key").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  limits: jsonb("limits").$type<ExecutionLimits>().notNull(),
  errorCode: text("error_code"),
  errorReference: text("error_reference"),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_jobs_org_idempotency_unique_idx").on(table.organizationId, table.idempotencyKey),
  uniqueIndex("execution_jobs_org_id_unique_idx").on(table.organizationId, table.id),
  index("execution_jobs_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
  index("execution_jobs_workspace_idx").on(table.workspaceId, table.createdAt),
  index("execution_jobs_recovery_idx").on(table.status, table.leaseExpiresAt, table.updatedAt),
]);

export const executionSteps = pgTable("execution_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  executionJobId: uuid("execution_job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  stepKind: text("step_kind").notNull(),
  status: text("status").notNull().default("queued"),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_steps_job_sequence_unique_idx").on(table.executionJobId, table.sequence),
  index("execution_steps_org_job_status_idx").on(table.organizationId, table.executionJobId, table.status),
]);

export const executionEvents = pgTable("execution_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  executionJobId: uuid("execution_job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_events_job_sequence_unique_idx").on(table.executionJobId, table.sequence),
  index("execution_events_org_job_sequence_idx").on(table.organizationId, table.executionJobId, table.sequence),
]);

export const executionArtifacts = pgTable("execution_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  executionJobId: uuid("execution_job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  executionStepId: uuid("execution_step_id").references(() => executionSteps.id, { onDelete: "set null" }),
  attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  workspacePath: text("workspace_path"),
  status: text("status").notNull().default("ready"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_artifacts_job_sha_filename_unique_idx").on(table.executionJobId, table.sha256, table.filename),
  index("execution_artifacts_org_job_idx").on(table.organizationId, table.executionJobId, table.createdAt),
  index("execution_artifacts_attachment_idx").on(table.attachmentId),
]);

export const executionUsage = pgTable("execution_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  executionJobId: uuid("execution_job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  cpuMs: bigint("cpu_ms", { mode: "number" }).notNull().default(0),
  memoryPeakBytes: bigint("memory_peak_bytes", { mode: "number" }).notNull().default(0),
  diskBytes: bigint("disk_bytes", { mode: "number" }).notNull().default(0),
  networkBytes: bigint("network_bytes", { mode: "number" }).notNull().default(0),
  outputBytes: bigint("output_bytes", { mode: "number" }).notNull().default(0),
  artifactBytes: bigint("artifact_bytes", { mode: "number" }).notNull().default(0),
  providerCostMicros: bigint("provider_cost_micros", { mode: "number" }).notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("execution_usage_job_unique_idx").on(table.executionJobId),
  index("execution_usage_org_updated_idx").on(table.organizationId, table.updatedAt),
]);
