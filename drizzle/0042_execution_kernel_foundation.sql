-- Execution Kernel Foundation: durable jobs, isolated workspaces, append-only events,
-- artifacts, leases, short-lived credential grants, and resource usage.
DO $$ BEGIN
  CREATE TYPE "execution_runner_kind" AS ENUM ('existing', 'gvisor', 'e2b', 'daytona');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "execution_workspace_state" AS ENUM ('provisioning', 'ready', 'running', 'paused', 'stopping', 'stopped', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "execution_job_status" AS ENUM (
    'queued', 'provisioning', 'ready', 'running', 'waiting_for_input',
    'waiting_for_approval', 'cancel_requested', 'cancelling', 'completed',
    'failed', 'timed_out', 'cancelled', 'orphaned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "execution_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "runner_kind" "execution_runner_kind" NOT NULL,
  "external_workspace_id" text,
  "template_id" text NOT NULL,
  "state" "execution_workspace_state" NOT NULL DEFAULT 'provisioning',
  "network_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "provisioned_at" timestamptz,
  "last_heartbeat_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "destroyed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_workspaces_org_id_unique_idx" ON "execution_workspaces" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "execution_workspaces_org_state_idx" ON "execution_workspaces" ("organization_id", "state", "updated_at");
CREATE INDEX IF NOT EXISTS "execution_workspaces_user_idx" ON "execution_workspaces" ("organization_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "execution_workspaces_expiry_idx" ON "execution_workspaces" ("expires_at", "state");

CREATE TABLE IF NOT EXISTS "execution_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "execution_workspaces"("id") ON DELETE RESTRICT,
  "parent_job_id" uuid REFERENCES "execution_jobs"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "status" "execution_job_status" NOT NULL DEFAULT 'queued',
  "priority" integer NOT NULL DEFAULT 0,
  "idempotency_key" text NOT NULL,
  "requested_input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "normalized_input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code" text,
  "error_reference" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "cancel_requested_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "execution_jobs_attempts_check" CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20),
  CONSTRAINT "execution_jobs_idempotency_length_check" CHECK (char_length("idempotency_key") BETWEEN 8 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_org_idempotency_unique_idx" ON "execution_jobs" ("organization_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_org_id_unique_idx" ON "execution_jobs" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "execution_jobs_org_status_idx" ON "execution_jobs" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "execution_jobs_user_status_idx" ON "execution_jobs" ("organization_id", "user_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "execution_jobs_expiry_idx" ON "execution_jobs" ("expires_at", "status");
CREATE INDEX IF NOT EXISTS "execution_jobs_workspace_idx" ON "execution_jobs" ("workspace_id", "created_at");

CREATE TABLE IF NOT EXISTS "execution_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "command_spec" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "input_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "exit_code" integer,
  "signal" text,
  "error_code" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "execution_steps_sequence_check" CHECK ("sequence" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_steps_job_sequence_unique_idx" ON "execution_steps" ("job_id", "sequence");
CREATE INDEX IF NOT EXISTS "execution_steps_job_status_idx" ON "execution_steps" ("job_id", "status", "sequence");

CREATE TABLE IF NOT EXISTS "execution_events" (
  "id" bigserial PRIMARY KEY,
  "job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "source" text NOT NULL,
  "level" text NOT NULL DEFAULT 'info',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "execution_events_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "execution_events_level_check" CHECK ("level" IN ('debug', 'info', 'warn', 'error'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_events_job_sequence_unique_idx" ON "execution_events" ("job_id", "sequence");
CREATE INDEX IF NOT EXISTS "execution_events_job_created_idx" ON "execution_events" ("job_id", "created_at");

CREATE OR REPLACE FUNCTION "prevent_execution_event_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'execution_events is append-only' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS "execution_events_append_only_update" ON "execution_events";
CREATE TRIGGER "execution_events_append_only_update"
BEFORE UPDATE ON "execution_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_execution_event_mutation"();
DROP TRIGGER IF EXISTS "execution_events_append_only_delete" ON "execution_events";
CREATE TRIGGER "execution_events_append_only_delete"
BEFORE DELETE ON "execution_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_execution_event_mutation"();

CREATE TABLE IF NOT EXISTS "execution_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE CASCADE,
  "step_id" uuid REFERENCES "execution_steps"("id") ON DELETE SET NULL,
  "storage_key" text NOT NULL,
  "filename" text NOT NULL,
  "media_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "kind" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "retention_until" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "execution_artifacts_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "execution_artifacts_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_artifacts_storage_key_unique_idx" ON "execution_artifacts" ("storage_key");
CREATE INDEX IF NOT EXISTS "execution_artifacts_org_job_idx" ON "execution_artifacts" ("organization_id", "job_id", "created_at");
CREATE INDEX IF NOT EXISTS "execution_artifacts_retention_idx" ON "execution_artifacts" ("retention_until");

CREATE TABLE IF NOT EXISTS "execution_leases" (
  "job_id" uuid PRIMARY KEY REFERENCES "execution_jobs"("id") ON DELETE CASCADE,
  "worker_id" text NOT NULL,
  "lease_token_hash" text NOT NULL,
  "acquired_at" timestamptz NOT NULL DEFAULT now(),
  "heartbeat_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "execution_leases_expiry_idx" ON "execution_leases" ("expires_at");
CREATE INDEX IF NOT EXISTS "execution_leases_worker_idx" ON "execution_leases" ("worker_id", "expires_at");

CREATE TABLE IF NOT EXISTS "execution_credential_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE CASCADE,
  "credential_id" uuid NOT NULL REFERENCES "provider_credentials"("id") ON DELETE CASCADE,
  "provider_kind" text NOT NULL,
  "allowed_hosts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "allowed_operations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "budget" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_credential_grants_token_hash_unique_idx" ON "execution_credential_grants" ("token_hash");
CREATE INDEX IF NOT EXISTS "execution_credential_grants_job_idx" ON "execution_credential_grants" ("organization_id", "job_id", "expires_at");
CREATE INDEX IF NOT EXISTS "execution_credential_grants_expiry_idx" ON "execution_credential_grants" ("expires_at", "revoked_at");

CREATE TABLE IF NOT EXISTS "execution_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "execution_jobs"("id") ON DELETE CASCADE,
  "cpu_milliseconds" bigint NOT NULL DEFAULT 0,
  "memory_peak_bytes" bigint NOT NULL DEFAULT 0,
  "disk_peak_bytes" bigint NOT NULL DEFAULT 0,
  "network_ingress_bytes" bigint NOT NULL DEFAULT 0,
  "network_egress_bytes" bigint NOT NULL DEFAULT 0,
  "stdout_bytes" bigint NOT NULL DEFAULT 0,
  "stderr_bytes" bigint NOT NULL DEFAULT 0,
  "artifact_bytes" bigint NOT NULL DEFAULT 0,
  "ai_input_tokens" bigint NOT NULL DEFAULT 0,
  "ai_output_tokens" bigint NOT NULL DEFAULT 0,
  "estimated_cost" numeric(18, 8) NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "execution_usage_nonnegative_check" CHECK (
    "cpu_milliseconds" >= 0 AND "memory_peak_bytes" >= 0 AND "disk_peak_bytes" >= 0 AND
    "network_ingress_bytes" >= 0 AND "network_egress_bytes" >= 0 AND "stdout_bytes" >= 0 AND
    "stderr_bytes" >= 0 AND "artifact_bytes" >= 0 AND "ai_input_tokens" >= 0 AND "ai_output_tokens" >= 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_usage_job_unique_idx" ON "execution_usage" ("job_id");
CREATE INDEX IF NOT EXISTS "execution_usage_org_user_idx" ON "execution_usage" ("organization_id", "user_id", "created_at");
