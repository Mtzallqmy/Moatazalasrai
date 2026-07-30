ALTER TYPE "run_status" ADD VALUE IF NOT EXISTS 'waiting_approval';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "runs_org_id_unique_idx"
  ON "runs" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tools_org_id_unique_idx"
  ON "mcp_tools" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_org_id_unique_idx"
  ON "mcp_servers" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_org_id_unique_idx"
  ON "agents" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_runs_org_id_unique_idx"
  ON "agent_team_runs" USING btree ("organization_id", "id");
--> statement-breakpoint
ALTER TABLE "tool_approvals"
  ADD COLUMN IF NOT EXISTS "approval_id" text,
  ADD COLUMN IF NOT EXISTS "tool_call_id" text,
  ADD COLUMN IF NOT EXISTS "server_id" uuid,
  ADD COLUMN IF NOT EXISTS "agent_id" uuid,
  ADD COLUMN IF NOT EXISTS "encrypted_arguments" text,
  ADD COLUMN IF NOT EXISTS "reason" text,
  ADD COLUMN IF NOT EXISTS "risk" text,
  ADD COLUMN IF NOT EXISTS "capability" text,
  ADD COLUMN IF NOT EXISTS "consumed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "tool_approvals"
SET "approval_id" = "id"::text
WHERE "approval_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "tool_approvals"
  ALTER COLUMN "approval_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tool_approvals"
  ADD CONSTRAINT "tool_approvals_server_id_mcp_servers_id_fk"
  FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "tool_approvals"
  ADD CONSTRAINT "tool_approvals_agent_id_agents_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_approvals_approval_id_unique_idx"
  ON "tool_approvals" USING btree ("approval_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_approvals_run_tool_call_unique_idx"
  ON "tool_approvals" USING btree ("run_id", "tool_call_id")
  WHERE "run_id" IS NOT NULL AND "tool_call_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_approvals_run_status_idx"
  ON "tool_approvals" USING btree ("organization_id", "run_id", "status", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "step_number" integer NOT NULL,
  "step_type" text NOT NULL,
  "status" text NOT NULL,
  "model" text,
  "provider_credential_id" uuid,
  "tool_call_id" text,
  "tool_id" uuid,
  "input_digest" text,
  "output_digest" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "duration_ms" integer,
  "error_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "agent_run_steps_org_run_fk"
    FOREIGN KEY ("organization_id", "run_id") REFERENCES "public"."runs"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "agent_run_steps_provider_credential_id_fk"
    FOREIGN KEY ("provider_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE set null,
  CONSTRAINT "agent_run_steps_org_tool_fk"
    FOREIGN KEY ("organization_id", "tool_id") REFERENCES "public"."mcp_tools"("organization_id", "id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_steps_run_number_unique_idx"
  ON "agent_run_steps" USING btree ("run_id", "step_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_steps_org_run_idx"
  ON "agent_run_steps" USING btree ("organization_id", "run_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_steps_tool_call_idx"
  ON "agent_run_steps" USING btree ("run_id", "tool_call_id")
  WHERE "tool_call_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "encrypted_state" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_run_checkpoints_org_run_fk"
    FOREIGN KEY ("organization_id", "run_id") REFERENCES "public"."runs"("organization_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_checkpoints_run_version_unique_idx"
  ON "agent_run_checkpoints" USING btree ("run_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_checkpoints_expiry_idx"
  ON "agent_run_checkpoints" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "mcp_tool_calls"
  ADD COLUMN IF NOT EXISTS "tool_call_id" text;
--> statement-breakpoint
ALTER TABLE "mcp_tool_calls"
  ADD CONSTRAINT "mcp_tool_calls_org_run_fk"
  FOREIGN KEY ("organization_id", "run_id") REFERENCES "public"."runs"("organization_id", "id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tool_calls_run_tool_call_unique_idx"
  ON "mcp_tool_calls" USING btree ("run_id", "tool_call_id")
  WHERE "run_id" IS NOT NULL AND "tool_call_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_team_runs"
  ADD COLUMN IF NOT EXISTS "graphile_job_id" text,
  ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "retry_requested_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_team_runs_worker_status_idx"
  ON "agent_team_runs" USING btree ("status", "created_at")
  WHERE "status" IN ('queued', 'running');
--> statement-breakpoint
ALTER TABLE "agent_team_run_steps"
  ADD COLUMN IF NOT EXISTS "stable_request_id" text,
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "duration_ms" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_run_steps_identity_unique_idx"
  ON "agent_team_run_steps" USING btree ("team_run_id", "step_type", "position");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_run_steps_stable_request_unique_idx"
  ON "agent_team_run_steps" USING btree ("organization_id", "stable_request_id")
  WHERE "stable_request_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worker_heartbeats" (
  "worker_id" text PRIMARY KEY NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stopping_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_heartbeats_last_seen_idx"
  ON "worker_heartbeats" USING btree ("last_seen_at");
