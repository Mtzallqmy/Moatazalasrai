import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { executionArtifacts, executionJobs, executionSteps, executionWorkspaces } from "@/db/execution-schema";
import { organizations, providerCredentials, users } from "@/db/schema";

export const toolRuns = pgTable("tool_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull(),
  toolVersion: text("tool_version").notNull(),
  executionJobId: uuid("execution_job_id").notNull().references(() => executionJobs.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"),
  title: text("title"),
  inputSummary: jsonb("input_summary").$type<Record<string, unknown>>().notNull().default({}),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  errorReference: text("error_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("tool_runs_org_execution_job_unique_idx").on(table.organizationId, table.executionJobId),
  index("tool_runs_org_user_created_idx").on(table.organizationId, table.userId, table.createdAt),
  index("tool_runs_org_tool_status_idx").on(table.organizationId, table.toolId, table.status),
]);

export const toolRunMessages = pgTable("tool_run_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  sequence: integer("sequence").notNull(),
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
  artifactId: uuid("artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  value: jsonb("value").$type<Record<string, unknown>>(),
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tool_run_inputs_org_run_idx").on(table.organizationId, table.toolRunId, table.createdAt),
]);

export const toolRunApprovals = pgTable("tool_run_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  executionStepId: uuid("execution_step_id").references(() => executionSteps.id, { onDelete: "set null" }),
  actionType: text("action_type").notNull(),
  riskLevel: text("risk_level").notNull(),
  requestedPayload: jsonb("requested_payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("tool_run_approvals_org_status_idx").on(table.organizationId, table.status, table.requestedAt),
  index("tool_run_approvals_run_idx").on(table.toolRunId, table.status),
]);

export const dataInterpreterSessions = pgTable("data_interpreter_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => executionWorkspaces.id, { onDelete: "cascade" }),
  activeDatasetArtifactIds: jsonb("active_dataset_artifact_ids").$type<string[]>().notNull().default([]),
  generatedCodeArtifactId: uuid("generated_code_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  notebookArtifactId: uuid("notebook_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("data_interpreter_sessions_org_run_unique_idx").on(table.organizationId, table.toolRunId),
  index("data_interpreter_sessions_expiry_idx").on(table.expiresAt),
]);

export const codingProjects = pgTable("coding_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceKind: text("source_kind").notNull(),
  repositoryConnectionId: uuid("repository_connection_id"),
  repositoryOwner: text("repository_owner"),
  repositoryName: text("repository_name"),
  baseBranch: text("base_branch"),
  workingBranch: text("working_branch"),
  workspaceId: uuid("workspace_id").references(() => executionWorkspaces.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("coding_projects_org_user_idx").on(table.organizationId, table.userId, table.updatedAt),
]);

export const codingAgentRuns = pgTable("coding_agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  codingProjectId: uuid("coding_project_id").notNull().references(() => codingProjects.id, { onDelete: "cascade" }),
  specificationArtifactId: uuid("specification_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  planArtifactId: uuid("plan_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  tasksArtifactId: uuid("tasks_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  patchArtifactId: uuid("patch_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  commitSha: text("commit_sha"),
  pullRequestUrl: text("pull_request_url"),
  verification: jsonb("verification").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("coding_agent_runs_org_run_unique_idx").on(table.organizationId, table.toolRunId),
  index("coding_agent_runs_project_idx").on(table.codingProjectId, table.updatedAt),
]);

export const browserAgentSessions = pgTable("browser_agent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => executionWorkspaces.id, { onDelete: "set null" }),
  startUrl: text("start_url").notNull(),
  allowedHosts: jsonb("allowed_hosts").$type<string[]>().notNull().default([]),
  activePageUrl: text("active_page_url"),
  browserContextRef: text("browser_context_ref"),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("browser_agent_sessions_org_run_unique_idx").on(table.organizationId, table.toolRunId),
  index("browser_agent_sessions_expiry_idx").on(table.expiresAt),
]);

export const voiceGenerationJobs = pgTable("voice_generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toolRunId: uuid("tool_run_id").notNull().references(() => toolRuns.id, { onDelete: "cascade" }),
  providerKind: text("provider_kind").notNull(),
  providerCredentialId: uuid("provider_credential_id").notNull().references(() => providerCredentials.id, { onDelete: "restrict" }),
  voiceId: text("voice_id").notNull(),
  language: text("language"),
  style: text("style"),
  speed: text("speed"),
  format: text("format").notNull(),
  sampleRate: integer("sample_rate"),
  textLength: integer("text_length").notNull(),
  durationSeconds: text("duration_seconds"),
  outputArtifactId: uuid("output_artifact_id").references(() => executionArtifacts.id, { onDelete: "set null" }),
  providerRequestId: text("provider_request_id"),
  costEstimate: text("cost_estimate"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("voice_generation_jobs_org_run_unique_idx").on(table.organizationId, table.toolRunId),
  index("voice_generation_jobs_provider_idx").on(table.organizationId, table.providerCredentialId, table.createdAt),
]);
