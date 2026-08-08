-- Phase 2 Operational AI Tools foundation. These tables link tool orchestration to the
-- shared Execution Kernel; no tool runner is enabled by this migration.
DO $$ BEGIN
  CREATE TYPE "tool_run_status" AS ENUM (
    'draft','validating','queued','running','waiting_for_input','waiting_for_approval',
    'verifying','completed','failed','timed_out','cancel_requested','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "tool_run_message_role" AS ENUM ('system','user','assistant','tool');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "tool_run_approval_status" AS ENUM ('pending','approved','rejected','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "tool_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tool_id" text NOT NULL,
  "tool_version" text NOT NULL,
  "execution_job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE RESTRICT,
  "status" "tool_run_status" NOT NULL DEFAULT 'draft',
  "title" text NOT NULL,
  "input_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code" text,
  "error_reference" text,
  "verification" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tool_runs_tool_id_length_check" CHECK (char_length("tool_id") BETWEEN 3 AND 100),
  CONSTRAINT "tool_runs_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 300)
);
CREATE UNIQUE INDEX IF NOT EXISTS "tool_runs_org_execution_job_unique_idx" ON "tool_runs" ("organization_id", "execution_job_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tool_runs_org_id_unique_idx" ON "tool_runs" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "tool_runs_org_status_created_idx" ON "tool_runs" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "tool_runs_user_created_idx" ON "tool_runs" ("organization_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "tool_runs_tool_created_idx" ON "tool_runs" ("organization_id", "tool_id", "created_at");

CREATE TABLE IF NOT EXISTS "tool_run_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "role" "tool_run_message_role" NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tool_run_messages_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "tool_run_messages_content_size_check" CHECK (octet_length("content") <= 262144)
);
CREATE UNIQUE INDEX IF NOT EXISTS "tool_run_messages_run_sequence_unique_idx" ON "tool_run_messages" ("tool_run_id", "sequence");
CREATE INDEX IF NOT EXISTS "tool_run_messages_org_run_idx" ON "tool_run_messages" ("organization_id", "tool_run_id", "sequence");

CREATE TABLE IF NOT EXISTS "tool_run_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE CASCADE,
  "input_kind" text NOT NULL,
  "artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE RESTRICT,
  "value" jsonb,
  "sha256" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tool_run_inputs_payload_check" CHECK ("artifact_id" IS NOT NULL OR "value" IS NOT NULL),
  CONSTRAINT "tool_run_inputs_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS "tool_run_inputs_org_run_idx" ON "tool_run_inputs" ("organization_id", "tool_run_id", "created_at");

CREATE TABLE IF NOT EXISTS "tool_run_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE CASCADE,
  "step_id" uuid REFERENCES "execution_steps"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "risk" text NOT NULL,
  "requested_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" "tool_run_approval_status" NOT NULL DEFAULT 'pending',
  "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "decision_reason" text,
  "expires_at" timestamptz NOT NULL,
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tool_run_approvals_org_status_idx" ON "tool_run_approvals" ("organization_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "tool_run_approvals_run_idx" ON "tool_run_approvals" ("organization_id", "tool_run_id", "created_at");

CREATE TABLE IF NOT EXISTS "data_interpreter_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tool_run_id" uuid NOT NULL UNIQUE REFERENCES "tool_runs"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "execution_workspaces"("id") ON DELETE RESTRICT,
  "dataset_profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "planner_output" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "repair_attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "data_interpreter_repair_attempts_check" CHECK ("repair_attempts" BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS "data_interpreter_sessions_org_idx" ON "data_interpreter_sessions" ("organization_id", "created_at");

CREATE TABLE IF NOT EXISTS "coding_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "source_kind" text NOT NULL,
  "repository_url" text,
  "default_branch" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "coding_projects_org_user_idx" ON "coding_projects" ("organization_id", "user_id", "created_at");

CREATE TABLE IF NOT EXISTS "coding_agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tool_run_id" uuid NOT NULL UNIQUE REFERENCES "tool_runs"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "coding_projects"("id") ON DELETE RESTRICT,
  "engine" text NOT NULL DEFAULT 'internal',
  "branch_name" text,
  "specification_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE SET NULL,
  "plan_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE SET NULL,
  "tasks_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE SET NULL,
  "verification_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "coding_agent_runs_org_project_idx" ON "coding_agent_runs" ("organization_id", "project_id", "created_at");

CREATE TABLE IF NOT EXISTS "browser_agent_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tool_run_id" uuid NOT NULL UNIQUE REFERENCES "tool_runs"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "execution_workspaces"("id") ON DELETE RESTRICT,
  "engine" text NOT NULL DEFAULT 'playwright',
  "start_url" text NOT NULL,
  "allowed_hosts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "plan" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "final_state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "browser_agent_sessions_org_expiry_idx" ON "browser_agent_sessions" ("organization_id", "expires_at");

CREATE TABLE IF NOT EXISTS "voice_generation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tool_run_id" uuid NOT NULL UNIQUE REFERENCES "tool_runs"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE RESTRICT,
  "voice_id" text NOT NULL,
  "language" text,
  "profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "character_count" integer NOT NULL,
  "chunk_count" integer NOT NULL DEFAULT 0,
  "estimated_cost" numeric(18,8) NOT NULL DEFAULT 0,
  "final_cost" numeric(18,8),
  "output_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE SET NULL,
  "metadata_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "voice_generation_character_count_check" CHECK ("character_count" > 0),
  CONSTRAINT "voice_generation_chunk_count_check" CHECK ("chunk_count" BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS "voice_generation_jobs_org_provider_idx" ON "voice_generation_jobs" ("organization_id", "provider", "created_at");
