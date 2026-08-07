CREATE TABLE IF NOT EXISTS "tool_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "tool_id" text NOT NULL,
  "tool_version" text NOT NULL,
  "execution_job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE cascade,
  "status" text DEFAULT 'draft' NOT NULL,
  "title" text,
  "input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_summary" jsonb,
  "error_code" text,
  "error_reference" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "tool_runs_org_execution_job_unique_idx" ON "tool_runs" ("organization_id", "execution_job_id");
CREATE INDEX IF NOT EXISTS "tool_runs_org_user_created_idx" ON "tool_runs" ("organization_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "tool_runs_org_tool_status_idx" ON "tool_runs" ("organization_id", "tool_id", "status");

CREATE TABLE IF NOT EXISTS "tool_run_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sequence" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tool_run_messages_run_sequence_unique_idx" ON "tool_run_messages" ("tool_run_id", "sequence");
CREATE INDEX IF NOT EXISTS "tool_run_messages_org_run_idx" ON "tool_run_messages" ("organization_id", "tool_run_id", "sequence");

CREATE TABLE IF NOT EXISTS "tool_run_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE cascade,
  "input_kind" text NOT NULL,
  "artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "value" jsonb,
  "sha256" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "tool_run_inputs_org_run_idx" ON "tool_run_inputs" ("organization_id", "tool_run_id", "created_at");

CREATE TABLE IF NOT EXISTS "tool_run_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE cascade,
  "execution_step_id" uuid REFERENCES "execution_steps"("id") ON DELETE set null,
  "action_type" text NOT NULL,
  "risk_level" text NOT NULL,
  "requested_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_at" timestamptz DEFAULT now() NOT NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamptz,
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "tool_run_approvals_org_status_idx" ON "tool_run_approvals" ("organization_id", "status", "requested_at");
CREATE INDEX IF NOT EXISTS "tool_run_approvals_run_idx" ON "tool_run_approvals" ("tool_run_id", "status");

CREATE TABLE IF NOT EXISTS "data_interpreter_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "execution_workspaces"("id") ON DELETE cascade,
  "active_dataset_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "generated_code_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "notebook_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "data_interpreter_sessions_org_run_unique_idx" ON "data_interpreter_sessions" ("organization_id", "tool_run_id");
CREATE INDEX IF NOT EXISTS "data_interpreter_sessions_expiry_idx" ON "data_interpreter_sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "coding_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "source_kind" text NOT NULL,
  "repository_connection_id" uuid,
  "repository_owner" text,
  "repository_name" text,
  "base_branch" text,
  "working_branch" text,
  "workspace_id" uuid REFERENCES "execution_workspaces"("id") ON DELETE set null,
  "status" text DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "coding_projects_org_user_idx" ON "coding_projects" ("organization_id", "user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "coding_agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE cascade,
  "coding_project_id" uuid NOT NULL REFERENCES "coding_projects"("id") ON DELETE cascade,
  "specification_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "plan_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "tasks_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "patch_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "commit_sha" text,
  "pull_request_url" text,
  "verification" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "coding_agent_runs_org_run_unique_idx" ON "coding_agent_runs" ("organization_id", "tool_run_id");
CREATE INDEX IF NOT EXISTS "coding_agent_runs_project_idx" ON "coding_agent_runs" ("coding_project_id", "updated_at");

CREATE TABLE IF NOT EXISTS "browser_agent_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE cascade,
  "workspace_id" uuid REFERENCES "execution_workspaces"("id") ON DELETE set null,
  "start_url" text NOT NULL,
  "allowed_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active_page_url" text,
  "browser_context_ref" text,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_agent_sessions_org_run_unique_idx" ON "browser_agent_sessions" ("organization_id", "tool_run_id");
CREATE INDEX IF NOT EXISTS "browser_agent_sessions_expiry_idx" ON "browser_agent_sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "voice_generation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "tool_run_id" uuid NOT NULL REFERENCES "tool_runs"("id") ON DELETE cascade,
  "provider_kind" text NOT NULL,
  "provider_credential_id" uuid NOT NULL REFERENCES "provider_credentials"("id") ON DELETE restrict,
  "voice_id" text NOT NULL,
  "language" text,
  "style" text,
  "speed" text,
  "format" text NOT NULL,
  "sample_rate" integer,
  "text_length" integer NOT NULL,
  "duration_seconds" text,
  "output_artifact_id" uuid REFERENCES "execution_artifacts"("id") ON DELETE set null,
  "provider_request_id" text,
  "cost_estimate" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "voice_generation_jobs_org_run_unique_idx" ON "voice_generation_jobs" ("organization_id", "tool_run_id");
CREATE INDEX IF NOT EXISTS "voice_generation_jobs_provider_idx" ON "voice_generation_jobs" ("organization_id", "provider_credential_id", "created_at");
