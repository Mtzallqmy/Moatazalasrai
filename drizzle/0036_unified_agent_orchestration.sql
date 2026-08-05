CREATE TABLE IF NOT EXISTS "agent_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE set null,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "goal" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "result" jsonb,
  "stop_reason" text,
  "error_code" text,
  "error_message" text,
  "idempotency_key" text NOT NULL,
  "request_source" text DEFAULT 'dashboard' NOT NULL,
  "max_model_steps" integer DEFAULT 12 NOT NULL,
  "max_tool_calls" integer DEFAULT 20 NOT NULL,
  "max_duration_ms" integer DEFAULT 600000 NOT NULL,
  "max_output_bytes" integer DEFAULT 1048576 NOT NULL,
  "max_estimated_cost_micros" integer DEFAULT 1000000 NOT NULL,
  "model_steps_used" integer DEFAULT 0 NOT NULL,
  "tool_calls_used" integer DEFAULT 0 NOT NULL,
  "output_bytes_used" integer DEFAULT 0 NOT NULL,
  "estimated_cost_micros" integer DEFAULT 0 NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "recoveries" integer DEFAULT 0 NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "cancel_requested_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tasks_org_idempotency_unique_idx" ON "agent_tasks" ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_tasks_org_status_created_idx" ON "agent_tasks" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "agent_tasks_recovery_idx" ON "agent_tasks" ("status", "lease_expires_at", "updated_at");
CREATE INDEX IF NOT EXISTS "agent_tasks_conversation_idx" ON "agent_tasks" ("organization_id", "conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "agent_task_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "agent_tasks"("id") ON DELETE cascade,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE set null,
  "position" integer NOT NULL,
  "plan_step_id" text NOT NULL,
  "goal" text NOT NULL,
  "expected_tool" text,
  "success_criteria" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "result" jsonb,
  "error_code" text,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "idempotency_key" text NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_task_steps_task_position_unique_idx" ON "agent_task_steps" ("task_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_task_steps_org_idempotency_unique_idx" ON "agent_task_steps" ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_task_steps_org_task_status_idx" ON "agent_task_steps" ("organization_id", "task_id", "status");

CREATE TABLE IF NOT EXISTS "agent_task_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "agent_tasks"("id") ON DELETE cascade,
  "task_step_id" uuid REFERENCES "agent_task_steps"("id") ON DELETE set null,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE set null,
  "tool_call_id" text NOT NULL,
  "tool_name" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "input_digest" text NOT NULL,
  "output" jsonb,
  "error_code" text,
  "side_effectful" boolean DEFAULT false NOT NULL,
  "idempotency_key" text NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_task_tool_calls_task_call_unique_idx" ON "agent_task_tool_calls" ("task_id", "tool_call_id");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_task_tool_calls_org_idempotency_unique_idx" ON "agent_task_tool_calls" ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_task_tool_calls_org_task_status_idx" ON "agent_task_tool_calls" ("organization_id", "task_id", "status");

CREATE TABLE IF NOT EXISTS "agent_task_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "agent_tasks"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "reason" text NOT NULL,
  "encrypted_state" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_task_checkpoints_task_version_unique_idx" ON "agent_task_checkpoints" ("task_id", "version");
CREATE INDEX IF NOT EXISTS "agent_task_checkpoints_org_task_idx" ON "agent_task_checkpoints" ("organization_id", "task_id", "version");

CREATE TABLE IF NOT EXISTS "agent_task_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "agent_tasks"("id") ON DELETE cascade,
  "task_step_id" uuid REFERENCES "agent_task_steps"("id") ON DELETE set null,
  "attachment_id" uuid NOT NULL REFERENCES "attachments"("id") ON DELETE cascade,
  "kind" text DEFAULT 'artifact' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_task_artifacts_task_attachment_unique_idx" ON "agent_task_artifacts" ("task_id", "attachment_id");
CREATE INDEX IF NOT EXISTS "agent_task_artifacts_org_task_idx" ON "agent_task_artifacts" ("organization_id", "task_id", "created_at");
