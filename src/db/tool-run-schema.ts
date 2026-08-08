import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { executionArtifacts, executionJobs, executionSteps, executionWorkspaces } from "./execution-schema";
import { organizations, providerCredentials, users } from "./schema";

export const toolRunStatus = pgEnum("tool_run_status", [
  "draft",
  "validating",
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "verifying",
  "completed",
  "failed",
  "timed_out",
  "cancel_requested",
  "cancelled",
]);

export const toolRunMessageRole = pgEnum("tool_run_message_role", ["system", "user", "assistant", "tool"]);
export const toolRunApprovalStatus = pgEnum("tool_run_approval_status", ["pending", "approved", "rejected", "expired"]);

export const toolRuns = pgTable("tool_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull(),
  toolVersion: text("tool_version").notNull(),
  executionJobId: uuid("execution_job_id").notNull().references(() => executionJobs.id, { onDelete: "restrict" }),
  status: toolRunStatus("status").notNull().default("draft"),
  title: text("title").notNull(),
  inputSummary: jsonb("input_summary").$type<Record<string, unknown>>().notNull().default({}),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown>>().notNull().default({}),
  errorCode: text("error_code"),
  errorReference: text("error_reference"),
  verification: jsonb("verification").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tool_runs_org_execution_job_unique_idx").on(table.organizationId, table.executionJobId),
  uniqueIndex("tool_runs_org_id_unique_idx").on(table.organizationId, table.id),
  index("tool_runs_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
  index("tool_runs_user_created_idx").on(table.organizationId, table.userId, table.createdAt),
  index("tool_runs_tool_created_idx").on(table.organizationId, table.toolId, table.createdAt),
]);

export const toolRunMessages = pgTable("tool_run_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  role: toolRunMessageRole("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tool_run_messages_run_sequence_unique_idx").on(table.toolRunId, table.sequence),
  index("tool_run_messages_org_run_idx").on(table.organizationId, table.toolRunId, table.sequence),
]);

export const toolRunInputs = pgTable("tool_run_inputs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  inputKind: text("input_kind").notNull(),
  artifactId: uuid("artifact_id").references(() => executionArtifacts.id, { onDelete: "restrict" }),
  value: jsonb("value").$type<Record<string, unknown> | string | number | boolean | unknown[]>(),
  sha256: text("sha256"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tool_run_inputs_org_run_idx").on(table.organizationId, table.toolRunId, table.createdAt),
]);

export const toolRunApprovals = pgTable("tool_run_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => executionSteps.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  risk: text("risk").notNull(),
  requestedPayload: jsonb("requested_payload").$type<Record<string, unknown>>().notNull().default({}),
  status: toolRunApprovalStatus("status").notNull().default("pending"),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  decisionReason: text("decision_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tool_run_approvals_org_status_idx").on(table.organizationId, table.status, table.expiresAt),
  index("tool_run_approvals_run_idx").on(table.organizationId, table.toolRunId, table.createdAt),
]);

export const dataInterpreterSessions = pgTable("data_interpreter_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().unique().references(() => toolRuns.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => executionWorkspaces.id, { onDelete: "restrict" }),
  datasetProfile: jsonb("dataset_profile").$type<Record<string, unknown>>().notNull().default({}),
  plannerOutput: jsonb("planner_output").$type<Record<string, unknown>>().notNull().default({}),
  repairAttempts: integer("repair_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("data_interpreter_sessions_org_idx").on(table.organizationId, table.createdAt)]);

export const codingProjects = pgTable("coding_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceKind: text("source_kind").notNull(),
  repositoryUrl: text("repository_url"),
  defaultBranch: text("default_branch"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("coding_projects_org_user_idx").on(table.organizationId, table.userId, table.createdAt)]);

export const codingAgentRuns = pgTable("coding_agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().unique().references(() => toolRuns.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => codingProjects.id, { onDelete: "restrict" }),
  engine: text("engine").notNull().default("internal"),
  branchName: text("branch_name"),
  specificationArtifactId: uuid("specification_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  planArtifactId: uuid("plan_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  tasksArtifactId: uuid("tasks_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  verificationArtifactId: uuid("verification_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("coding_agent_runs_org_project_idx").on(table.organizationId, table.projectId, table.createdAt)]);

export const browserAgentSessions = pgTable("browser_agent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().unique().references(() => toolRuns.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => executionWorkspaces.id, { onDelete: "restrict" }),
  engine: text("engine").notNull().default("playwright"),
  startUrl: text("start_url").notNull(),
  allowedHosts: jsonb("allowed_hosts").$type<string[]>().notNull().default([]),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull().default({}),
  finalState: jsonb("final_state").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("browser_agent_sessions_org_expiry_idx").on(table.organizationId, table.expiresAt)]);

export const voiceGenerationJobs = pgTable("voice_generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().unique().references(() => toolRuns.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerCredentialId: uuid("provider_credential_id").references(() => providerCredentials.id, { onDelete: "restrict" }),
  voiceId: text("voice_id").notNull(),
  language: text("language"),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  characterCount: integer("character_count").notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 18, scale: 8 }).notNull().default("0"),
  finalCost: numeric("final_cost", { precision: 18, scale: 8 }),
  outputArtifactId: uuid("output_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  metadataArtifactId: uuid("metadata_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("voice_generation_jobs_org_provider_idx").on(table.organizationId, table.provider, table.createdAt)]);
