CREATE TABLE IF NOT EXISTS "execution_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "runner_kind" text NOT NULL,
  "template" text NOT NULL,
  "status" text DEFAULT 'provisioning' NOT NULL,
  "external_workspace_ref" text,
  "network_policy" jsonb DEFAULT '{"mode":"deny_all","hosts":[]}'::jsonb NOT NULL,
  "limits" jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_activity_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_workspaces_org_id_unique_idx" ON "execution_workspaces" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "execution_workspaces_org_status_idx" ON "execution_workspaces" ("organization_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "execution_workspaces_expiry_idx" ON "execution_workspaces" ("expires_at");

CREATE TABLE IF NOT EXISTS "execution_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "workspace_id" uuid REFERENCES "execution_workspaces"("id") ON DELETE set null,
  "execution_kind" text NOT NULL,
  "runner_kind" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "title" text,
  "idempotency_key" text NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "limits" jsonb NOT NULL,
  "error_code" text,
  "error_reference" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "cancel_requested_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_org_idempotency_unique_idx" ON "execution_jobs" ("organization_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_org_id_unique_idx" ON "execution_jobs" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "execution_jobs_org_status_created_idx" ON "execution_jobs" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "execution_jobs_workspace_idx" ON "execution_jobs" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "execution_jobs_recovery_idx" ON "execution_jobs" ("status", "lease_expires_at", "updated_at");

CREATE TABLE IF NOT EXISTS "execution_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "execution_job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE cascade,
  "sequence" integer NOT NULL,
  "step_kind" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output" jsonb,
  "error_code" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_steps_job_sequence_unique_idx" ON "execution_steps" ("execution_job_id", "sequence");
CREATE INDEX IF NOT EXISTS "execution_steps_org_job_status_idx" ON "execution_steps" ("organization_id", "execution_job_id", "status");

CREATE TABLE IF NOT EXISTS "execution_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "execution_job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE cascade,
  "sequence" integer NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_events_job_sequence_unique_idx" ON "execution_events" ("execution_job_id", "sequence");
CREATE INDEX IF NOT EXISTS "execution_events_org_job_sequence_idx" ON "execution_events" ("organization_id", "execution_job_id", "sequence");

CREATE TABLE IF NOT EXISTS "execution_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "execution_job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE cascade,
  "execution_step_id" uuid REFERENCES "execution_steps"("id") ON DELETE set null,
  "attachment_id" uuid REFERENCES "attachments"("id") ON DELETE set null,
  "kind" text NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "workspace_path" text,
  "status" text DEFAULT 'ready' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_artifacts_job_sha_filename_unique_idx" ON "execution_artifacts" ("execution_job_id", "sha256", "filename");
CREATE INDEX IF NOT EXISTS "execution_artifacts_org_job_idx" ON "execution_artifacts" ("organization_id", "execution_job_id", "created_at");
CREATE INDEX IF NOT EXISTS "execution_artifacts_attachment_idx" ON "execution_artifacts" ("attachment_id");

CREATE TABLE IF NOT EXISTS "execution_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "execution_job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE cascade,
  "cpu_ms" bigint DEFAULT 0 NOT NULL,
  "memory_peak_bytes" bigint DEFAULT 0 NOT NULL,
  "disk_bytes" bigint DEFAULT 0 NOT NULL,
  "network_bytes" bigint DEFAULT 0 NOT NULL,
  "output_bytes" bigint DEFAULT 0 NOT NULL,
  "artifact_bytes" bigint DEFAULT 0 NOT NULL,
  "provider_cost_micros" bigint DEFAULT 0 NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_usage_job_unique_idx" ON "execution_usage" ("execution_job_id");
CREATE INDEX IF NOT EXISTS "execution_usage_org_updated_idx" ON "execution_usage" ("organization_id", "updated_at");
