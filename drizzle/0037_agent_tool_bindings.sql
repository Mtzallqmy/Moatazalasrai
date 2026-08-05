CREATE TABLE IF NOT EXISTS "agent_tool_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "tool_name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "approval_mode" text DEFAULT 'risk_based' NOT NULL,
  "constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tool_bindings_agent_tool_unique_idx"
  ON "agent_tool_bindings" ("organization_id", "agent_id", "tool_name");
CREATE INDEX IF NOT EXISTS "agent_tool_bindings_org_agent_enabled_idx"
  ON "agent_tool_bindings" ("organization_id", "agent_id", "enabled");
