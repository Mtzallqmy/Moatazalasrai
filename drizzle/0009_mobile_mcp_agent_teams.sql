ALTER TABLE "platform_api_keys"
  ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "mobile_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "access_token_hash" text NOT NULL UNIQUE,
  "access_expires_at" timestamptz NOT NULL,
  "refresh_token_hash" text NOT NULL UNIQUE,
  "refresh_expires_at" timestamptz NOT NULL,
  "device_id" text NOT NULL,
  "device_name" text,
  "last_used_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_sessions_user_device_idx" ON "mobile_sessions" ("user_id", "device_id");
CREATE INDEX IF NOT EXISTS "mobile_sessions_access_expiry_idx" ON "mobile_sessions" ("access_expires_at");
CREATE INDEX IF NOT EXISTS "mobile_sessions_refresh_expiry_idx" ON "mobile_sessions" ("refresh_expires_at");

CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "endpoint" text NOT NULL,
  "transport" text NOT NULL DEFAULT 'streamable_http',
  "encrypted_bearer_token" text,
  "token_hint" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL DEFAULT 'pending',
  "protocol_version" text,
  "server_name" text,
  "server_version" text,
  "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_connected_at" timestamptz,
  "last_error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "name")
);
CREATE INDEX IF NOT EXISTS "mcp_servers_org_status_idx" ON "mcp_servers" ("organization_id", "status", "enabled");

CREATE TABLE IF NOT EXISTS "mcp_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "server_id" uuid NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "title" text,
  "description" text,
  "input_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output_schema" jsonb,
  "annotations" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "schema_hash" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "risk" text NOT NULL DEFAULT 'medium',
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("server_id", "name")
);
CREATE INDEX IF NOT EXISTS "mcp_tools_org_enabled_idx" ON "mcp_tools" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "agent_mcp_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "tool_id" uuid NOT NULL REFERENCES "mcp_tools"("id") ON DELETE CASCADE,
  "approval_mode" text NOT NULL DEFAULT 'risk_based',
  "max_calls_per_run" integer NOT NULL DEFAULT 3 CHECK ("max_calls_per_run" BETWEEN 1 AND 20),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("agent_id", "tool_id")
);
CREATE INDEX IF NOT EXISTS "agent_mcp_tools_org_idx" ON "agent_mcp_tools" ("organization_id");

CREATE TABLE IF NOT EXISTS "mcp_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "server_id" uuid NOT NULL REFERENCES "mcp_servers"("id"),
  "tool_id" uuid NOT NULL REFERENCES "mcp_tools"("id"),
  "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "input_digest" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "duration_ms" integer,
  "result" jsonb,
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "mcp_tool_calls_org_created_idx" ON "mcp_tool_calls" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_tool_calls_run_idx" ON "mcp_tool_calls" ("run_id");

CREATE TABLE IF NOT EXISTS "agent_teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "supervisor_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "enabled" boolean NOT NULL DEFAULT true,
  "max_parallel_workers" integer NOT NULL DEFAULT 3 CHECK ("max_parallel_workers" BETWEEN 1 AND 5),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "name")
);
CREATE INDEX IF NOT EXISTS "agent_teams_org_enabled_idx" ON "agent_teams" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "agent_team_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "team_id" uuid NOT NULL REFERENCES "agent_teams"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "role" text NOT NULL DEFAULT 'worker',
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("team_id", "agent_id")
);
CREATE INDEX IF NOT EXISTS "agent_team_members_org_idx" ON "agent_team_members" ("organization_id");

CREATE TABLE IF NOT EXISTS "agent_team_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "team_id" uuid NOT NULL REFERENCES "agent_teams"("id"),
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "request_id" text NOT NULL,
  "input" text NOT NULL,
  "output" text,
  "status" text NOT NULL DEFAULT 'queued',
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "completed_at" timestamptz,
  UNIQUE ("organization_id", "request_id")
);
CREATE INDEX IF NOT EXISTS "agent_team_runs_org_created_idx" ON "agent_team_runs" ("organization_id", "created_at");

CREATE TABLE IF NOT EXISTS "agent_team_run_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "team_run_id" uuid NOT NULL REFERENCES "agent_team_runs"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "step_type" text NOT NULL,
  "position" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "output" text,
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "agent_team_run_steps_run_idx" ON "agent_team_run_steps" ("team_run_id", "position");
CREATE INDEX IF NOT EXISTS "agent_team_run_steps_org_idx" ON "agent_team_run_steps" ("organization_id");
