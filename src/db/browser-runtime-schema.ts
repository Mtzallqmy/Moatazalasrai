import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { browserRiskLevel, browserTaskStatus } from "@/db/site-connections-schema";

export const browserTasksRuntime = pgTable("browser_tasks", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id"),
  agentId: uuid("agent_id").notNull(),
  siteConnectionId: uuid("site_connection_id").notNull(),
  instruction: text("instruction").notNull(),
  status: browserTaskStatus("status").notNull(),
  riskLevel: browserRiskLevel("risk_level").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>(),
  encryptedPlan: text("encrypted_plan"),
  externalTaskId: text("external_task_id"),
  runnerEventSequence: integer("runner_event_sequence").notNull().default(0),
  currentStep: integer("current_step").notNull().default(0),
  idempotencyKey: text("idempotency_key"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
