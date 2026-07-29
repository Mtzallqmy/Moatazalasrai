DO $$ BEGIN
  CREATE TYPE "provider_validation_status" AS ENUM ('pending', 'verified', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "message_role" AS ENUM ('user', 'assistant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "active_organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;

ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

ALTER TABLE "provider_credentials"
  ALTER COLUMN "validation_status" DROP DEFAULT;
ALTER TABLE "provider_credentials"
  ALTER COLUMN "validation_status" TYPE provider_validation_status
  USING CASE
    WHEN "validation_status" IN ('pending', 'verified', 'failed')
      THEN "validation_status"::provider_validation_status
    ELSE 'failed'::provider_validation_status
  END;
ALTER TABLE "provider_credentials"
  ALTER COLUMN "validation_status" SET DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "last_validation_latency_ms" integer,
  ADD COLUMN IF NOT EXISTS "last_error_code" text,
  ADD COLUMN IF NOT EXISTS "consecutive_failures" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "circuit_open_until" timestamptz;

ALTER TABLE "agent_versions"
  DROP COLUMN IF EXISTS "max_model_calls",
  DROP COLUMN IF EXISTS "max_tool_calls",
  DROP COLUMN IF EXISTS "tools";

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

ALTER TABLE "messages"
  ALTER COLUMN "role" TYPE message_role USING "role"::message_role;

ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "request_id" text,
  ADD COLUMN IF NOT EXISTS "provider_request_id" text,
  ADD COLUMN IF NOT EXISTS "error_code" text,
  ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamptz;

UPDATE "runs" SET "request_id" = "id"::text WHERE "request_id" IS NULL;
ALTER TABLE "runs" ALTER COLUMN "request_id" SET NOT NULL;
ALTER TABLE "runs" ALTER COLUMN "input_tokens" DROP NOT NULL;
ALTER TABLE "runs" ALTER COLUMN "input_tokens" DROP DEFAULT;
ALTER TABLE "runs" ALTER COLUMN "output_tokens" DROP NOT NULL;
ALTER TABLE "runs" ALTER COLUMN "output_tokens" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "rate_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope" text NOT NULL,
  "key_hash" text NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 1,
  "expires_at" timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS "sessions_active_org_idx" ON "sessions" ("active_organization_id");
CREATE INDEX IF NOT EXISTS "organization_members_org_role_idx" ON "organization_members" ("organization_id", "role");
CREATE INDEX IF NOT EXISTS "platform_api_keys_org_idx" ON "platform_api_keys" ("organization_id");
CREATE INDEX IF NOT EXISTS "provider_credentials_org_idx" ON "provider_credentials" ("organization_id");
CREATE INDEX IF NOT EXISTS "provider_credentials_org_status_idx" ON "provider_credentials" ("organization_id", "validation_status", "enabled");
CREATE INDEX IF NOT EXISTS "agents_org_status_idx" ON "agents" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "agents_org_updated_idx" ON "agents" ("organization_id", "updated_at");
CREATE INDEX IF NOT EXISTS "agent_versions_provider_idx" ON "agent_versions" ("provider_credential_id");
CREATE INDEX IF NOT EXISTS "conversations_org_updated_idx" ON "conversations" ("organization_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "conversations_org_archived_idx" ON "conversations" ("organization_id", "archived_at");
CREATE INDEX IF NOT EXISTS "conversations_agent_idx" ON "conversations" ("agent_id");
CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx" ON "messages" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "runs_org_status_idx" ON "runs" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "runs_conversation_idx" ON "runs" ("conversation_id");
CREATE INDEX IF NOT EXISTS "runs_agent_idx" ON "runs" ("agent_id");
CREATE INDEX IF NOT EXISTS "runs_request_idx" ON "runs" ("request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "run_events_run_sequence_unique_idx" ON "run_events" ("run_id", "sequence");
CREATE INDEX IF NOT EXISTS "run_events_run_created_idx" ON "run_events" ("run_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" ("actor_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limits_scope_key_window_idx" ON "rate_limits" ("scope", "key_hash", "window_started_at");
CREATE INDEX IF NOT EXISTS "rate_limits_expires_idx" ON "rate_limits" ("expires_at");

DROP TABLE IF EXISTS "tasks";
