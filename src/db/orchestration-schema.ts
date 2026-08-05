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
import {
  agents,
  attachments,
  conversations,
  organizations,
  runs,
  users,
} from "@/db/schema";

export type AgentTaskPlanStep = {
  id: string;
  goal: string;
  expectedTool?: string | null;
  successCriteria: string;
};

export const agentTasks = pgTable("agent_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("queued"),
  plan: jsonb("plan").$type<AgentTaskPlanStep[]>().notNull().default([]),
  result: jsonb("result").$type<Record<string, unknown>>(),
  stopReason: text("stop_reason"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  idempotencyKey: text("idempotency_key").notNull(),
  requestSource: text("request_source").notNull().default("dashboard"),
  maxModelSteps: integer("max_model_steps").notNull().default(12),
  maxToolCalls: integer("max_tool_calls").notNull().default(20),
  maxDurationMs: integer("max_duration_ms").notNull().default(600000),
  maxOutputBytes: integer("max_output_bytes").notNull().default(1048576),
  maxEstimatedCostMicros: integer("max_estimated_cost_micros").notNull().default(1000000),
  modelStepsUsed: integer("model_steps_used").notNull().default(0),
  toolCallsUsed: integer("tool_calls_used").notNull().default(0),
  outputBytesUsed: integer("output_bytes_used").notNull().default(0),
  estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  recoveries: integer("recoveries").notNull().default(0),
  currentStep: integer("current_step").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_tasks_org_idempotency_unique_idx").on(table.organizationId, table.idempotencyKey),
  index("agent_tasks_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
  index("agent_tasks_recovery_idx").on(table.status, table.leaseExpiresAt, table.updatedAt),
  index("agent_tasks_conversation_idx").on(table.organizationId, table.conversationId, table.createdAt),
]);

export const agentTaskSteps = pgTable("agent_task_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  position: integer("position").notNull(),
  planStepId: text("plan_step_id").notNull(),
  goal: text("goal").notNull(),
  expectedTool: text("expected_tool"),
  successCriteria: text("success_criteria").notNull(),
  status: text("status").notNull().default("queued"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  retryCount: integer("retry_count").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_task_steps_task_position_unique_idx").on(table.taskId, table.position),
  uniqueIndex("agent_task_steps_org_idempotency_unique_idx").on(table.organizationId, table.idempotencyKey),
  index("agent_task_steps_org_task_status_idx").on(table.organizationId, table.taskId, table.status),
]);

export const agentTaskToolCalls = pgTable("agent_task_tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  taskStepId: uuid("task_step_id").references(() => agentTaskSteps.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  toolCallId: text("tool_call_id").notNull(),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull().default("queued"),
  inputDigest: text("input_digest").notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  sideEffectful: integer("side_effectful").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_task_tool_calls_task_call_unique_idx").on(table.taskId, table.toolCallId),
  uniqueIndex("agent_task_tool_calls_org_idempotency_unique_idx").on(table.organizationId, table.idempotencyKey),
  index("agent_task_tool_calls_org_task_status_idx").on(table.organizationId, table.taskId, table.status),
]);

export const agentTaskCheckpoints = pgTable("agent_task_checkpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  reason: text("reason").notNull(),
  encryptedState: text("encrypted_state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_task_checkpoints_task_version_unique_idx").on(table.taskId, table.version),
  index("agent_task_checkpoints_org_task_idx").on(table.organizationId, table.taskId, table.version),
]);

export const agentTaskArtifacts = pgTable("agent_task_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  taskStepId: uuid("task_step_id").references(() => agentTaskSteps.id, { onDelete: "set null" }),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("artifact"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_task_artifacts_task_attachment_unique_idx").on(table.taskId, table.attachmentId),
  index("agent_task_artifacts_org_task_idx").on(table.organizationId, table.taskId, table.createdAt),
]);
