DO $$ BEGIN
  CREATE TYPE "sandbox_workspace_status" AS ENUM ('provisioning', 'ready', 'paused', 'resetting', 'failed', 'terminated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "sandbox_execution_status" AS ENUM ('queued', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled', 'timed_out');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "sandbox_permission_action" AS ENUM (
    'create', 'exec', 'read_file', 'write_file', 'delete_file', 'list_files',
    'upload_file', 'download_artifact', 'stop_execution', 'reset', 'network'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "sandbox_permission_policy" AS ENUM ('allow', 'require_approval', 'deny');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "sandbox_risk_level" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "sandbox_artifact_status" AS ENUM ('pending', 'ready', 'deleted', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sandbox_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "name" text NOT NULL,
  "provider" text DEFAULT 'isolated_runner' NOT NULL,
  "external_workspace_id" text,
  "template" text DEFAULT 'moataz-code' NOT NULL,
  "status" "sandbox_workspace_status" DEFAULT 'provisioning' NOT NULL,
  "network_mode" text DEFAULT 'disabled' NOT NULL,
  "disk_limit_bytes" bigint NOT NULL,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_workspaces_org_id_unique_idx" ON "sandbox_workspaces" ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_workspaces_org_status_idx" ON "sandbox_workspaces" ("organization_id", "status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_workspaces_expiry_idx" ON "sandbox_workspaces" ("expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conversation_sandbox_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "sandbox_workspaces"("id") ON DELETE cascade,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_sandbox_workspaces_pair_unique_idx" ON "conversation_sandbox_workspaces" ("conversation_id", "workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_sandbox_workspaces_active_unique_idx"
  ON "conversation_sandbox_workspaces" ("organization_id", "conversation_id") WHERE "active" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_sandbox_workspaces_org_idx" ON "conversation_sandbox_workspaces" ("organization_id", "conversation_id", "active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sandbox_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "sandbox_workspaces"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "action" "sandbox_permission_action" NOT NULL,
  "policy" "sandbox_permission_policy" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_permissions_workspace_agent_action_unique_idx" ON "sandbox_permissions" ("workspace_id", "agent_id", "action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_permissions_org_agent_idx" ON "sandbox_permissions" ("organization_id", "agent_id", "workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sandbox_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "sandbox_workspaces"("id") ON DELETE cascade,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE set null,
  "message_id" uuid REFERENCES "messages"("id") ON DELETE set null,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "encrypted_command" text NOT NULL,
  "command_summary" text NOT NULL,
  "working_directory" text DEFAULT '.' NOT NULL,
  "status" "sandbox_execution_status" DEFAULT 'queued' NOT NULL,
  "risk_level" "sandbox_risk_level" DEFAULT 'low' NOT NULL,
  "policy_decision" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "external_execution_id" text,
  "timeout_ms" integer NOT NULL,
  "exit_code" integer,
  "stdout_bytes" integer DEFAULT 0 NOT NULL,
  "stderr_bytes" integer DEFAULT 0 NOT NULL,
  "output_truncated" boolean DEFAULT false NOT NULL,
  "error_code" text,
  "error_message" text,
  "cancel_requested_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_executions_org_id_unique_idx" ON "sandbox_executions" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_executions_org_idempotency_unique_idx" ON "sandbox_executions" ("organization_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_executions_org_status_idx" ON "sandbox_executions" ("organization_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_executions_workspace_idx" ON "sandbox_executions" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_executions_conversation_idx" ON "sandbox_executions" ("organization_id", "conversation_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sandbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "execution_id" uuid NOT NULL REFERENCES "sandbox_executions"("id") ON DELETE cascade,
  "sequence" integer NOT NULL,
  "type" text NOT NULL,
  "stream" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_events_execution_sequence_unique_idx" ON "sandbox_events" ("execution_id", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_events_org_execution_idx" ON "sandbox_events" ("organization_id", "execution_id", "sequence");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sandbox_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "sandbox_workspaces"("id") ON DELETE cascade,
  "path" text NOT NULL,
  "mime_type" text,
  "size_bytes" bigint DEFAULT 0 NOT NULL,
  "sha256" text,
  "is_directory" boolean DEFAULT false NOT NULL,
  "modified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_files_workspace_path_unique_idx" ON "sandbox_files" ("workspace_id", "path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_files_org_workspace_idx" ON "sandbox_files" ("organization_id", "workspace_id", "path");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sandbox_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "sandbox_workspaces"("id") ON DELETE cascade,
  "execution_id" uuid REFERENCES "sandbox_executions"("id") ON DELETE set null,
  "file_id" uuid REFERENCES "sandbox_files"("id") ON DELETE set null,
  "object_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "status" "sandbox_artifact_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "downloaded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_artifacts_object_key_unique_idx" ON "sandbox_artifacts" ("object_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_artifacts_org_expiry_idx" ON "sandbox_artifacts" ("organization_id", "status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_artifacts_workspace_idx" ON "sandbox_artifacts" ("workspace_id", "created_at");
--> statement-breakpoint

ALTER TABLE "tool_approvals" ADD COLUMN IF NOT EXISTS "sandbox_execution_id" uuid REFERENCES "sandbox_executions"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "tool_approvals" ADD COLUMN IF NOT EXISTS "action_snapshot" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_approvals_sandbox_execution_unique_idx"
  ON "tool_approvals" ("sandbox_execution_id") WHERE "sandbox_execution_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_approvals_sandbox_status_idx"
  ON "tool_approvals" ("organization_id", "sandbox_execution_id", "status", "expires_at")
  WHERE "sandbox_execution_id" IS NOT NULL;
