DO $$ BEGIN
  CREATE TYPE "site_connector_type" AS ENUM ('oauth', 'api', 'browser');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "site_connection_status" AS ENUM ('pending', 'verified', 'expired', 'revoked', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "site_permission_action" AS ENUM (
    'read', 'search', 'navigate', 'fill_form', 'create', 'update', 'upload', 'download',
    'send', 'publish', 'delete', 'invite_users', 'purchase', 'payment',
    'account_settings', 'security_settings'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "site_permission_policy" AS ENUM ('allow', 'require_approval', 'deny');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "browser_task_status" AS ENUM (
    'queued', 'planning', 'awaiting_connection', 'running', 'awaiting_approval',
    'completed', 'failed', 'cancelled', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "browser_risk_level" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "browser_task_step_status" AS ENUM (
    'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "site_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "name" text NOT NULL,
  "site_domain" text NOT NULL,
  "connector_type" "site_connector_type" NOT NULL,
  "connector_key" text NOT NULL,
  "status" "site_connection_status" DEFAULT 'pending' NOT NULL,
  "encrypted_credentials" text,
  "encrypted_session_state" text,
  "credential_key_id" text,
  "credential_hint" text,
  "granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_verified_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_connections_org_name_unique_idx"
  ON "site_connections" ("organization_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_connections_org_id_unique_idx"
  ON "site_connections" ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_connections_org_status_idx"
  ON "site_connections" ("organization_id", "status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_connections_connector_idx"
  ON "site_connections" ("connector_key", "connector_type");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_site_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "site_connection_id" uuid NOT NULL REFERENCES "site_connections"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_site_connections_agent_connection_unique_idx"
  ON "agent_site_connections" ("agent_id", "site_connection_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_site_connections_org_id_unique_idx"
  ON "agent_site_connections" ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_site_connections_org_agent_idx"
  ON "agent_site_connections" ("organization_id", "agent_id", "enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_site_connections_org_connection_idx"
  ON "agent_site_connections" ("organization_id", "site_connection_id", "enabled");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "site_connection_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "agent_site_connection_id" uuid NOT NULL REFERENCES "agent_site_connections"("id") ON DELETE cascade,
  "action" "site_permission_action" NOT NULL,
  "policy" "site_permission_policy" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_connection_permissions_assignment_action_unique_idx"
  ON "site_connection_permissions" ("agent_site_connection_id", "action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_connection_permissions_org_assignment_idx"
  ON "site_connection_permissions" ("organization_id", "agent_site_connection_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "browser_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "site_connection_id" uuid NOT NULL REFERENCES "site_connections"("id"),
  "instruction" text NOT NULL,
  "status" "browser_task_status" DEFAULT 'queued' NOT NULL,
  "risk_level" "browser_risk_level" DEFAULT 'low' NOT NULL,
  "plan" jsonb,
  "current_step" integer DEFAULT 0 NOT NULL,
  "idempotency_key" text,
  "error_code" text,
  "error_message" text,
  "cancel_requested_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_tasks_org_idempotency_unique_idx"
  ON "browser_tasks" ("organization_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_tasks_org_id_unique_idx"
  ON "browser_tasks" ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_tasks_org_status_idx"
  ON "browser_tasks" ("organization_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_tasks_connection_idx"
  ON "browser_tasks" ("site_connection_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_tasks_agent_idx"
  ON "browser_tasks" ("organization_id", "agent_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "browser_task_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "browser_task_id" uuid NOT NULL REFERENCES "browser_tasks"("id") ON DELETE cascade,
  "sequence" integer NOT NULL,
  "action" text NOT NULL,
  "target" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "input_redacted" jsonb,
  "required_permission" "site_permission_action" NOT NULL,
  "risk_level" "browser_risk_level" NOT NULL,
  "status" "browser_task_step_status" DEFAULT 'queued' NOT NULL,
  "expected_result" text,
  "result" jsonb,
  "screenshot_object_key" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_task_steps_task_sequence_unique_idx"
  ON "browser_task_steps" ("browser_task_id", "sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_task_steps_org_id_unique_idx"
  ON "browser_task_steps" ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_task_steps_org_task_idx"
  ON "browser_task_steps" ("organization_id", "browser_task_id", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_task_steps_status_idx"
  ON "browser_task_steps" ("status", "created_at");
--> statement-breakpoint

ALTER TABLE "tool_approvals"
  ADD COLUMN IF NOT EXISTS "browser_task_id" uuid REFERENCES "browser_tasks"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "tool_approvals"
  ADD COLUMN IF NOT EXISTS "browser_task_step_id" uuid REFERENCES "browser_task_steps"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "tool_approvals"
  ADD COLUMN IF NOT EXISTS "action_snapshot" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_approvals_browser_task_step_unique_idx"
  ON "tool_approvals" ("browser_task_step_id")
  WHERE "browser_task_step_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_approvals_browser_task_status_idx"
  ON "tool_approvals" ("organization_id", "browser_task_id", "status", "expires_at")
  WHERE "browser_task_id" IS NOT NULL;
