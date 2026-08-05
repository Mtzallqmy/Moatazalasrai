CREATE TABLE IF NOT EXISTS "platform_whatsapp_endpoints" (
  "id" text PRIMARY KEY DEFAULT 'primary' NOT NULL,
  "phone_number_id" text NOT NULL,
  "business_account_id" text NOT NULL,
  "display_phone_number" text NOT NULL,
  "credential_source" text DEFAULT 'environment' NOT NULL,
  "configuration_fingerprint" text NOT NULL,
  "default_organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'healthy' NOT NULL,
  "last_validated_at" timestamptz,
  "last_error_code" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_whatsapp_endpoint_phone_unique_idx" ON "platform_whatsapp_endpoints" ("phone_number_id");
CREATE INDEX IF NOT EXISTS "platform_whatsapp_endpoint_status_idx" ON "platform_whatsapp_endpoints" ("status", "updated_at");

CREATE TABLE IF NOT EXISTS "platform_whatsapp_defaults" (
  "id" text PRIMARY KEY DEFAULT 'primary' NOT NULL,
  "default_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "default_provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  "default_model" text,
  "default_permissions" jsonb DEFAULT '["ai.chat","agent.use","conversation.open"]'::jsonb NOT NULL,
  "default_allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "default_allowed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "monthly_limit" integer,
  "auto_reply_enabled" boolean DEFAULT true NOT NULL,
  "human_handoff_enabled" boolean DEFAULT true NOT NULL,
  "memory_enabled" boolean DEFAULT true NOT NULL,
  "files_enabled" boolean DEFAULT true NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
INSERT INTO "platform_whatsapp_defaults" ("id") VALUES ('primary') ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "whatsapp_organization_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  "model_id" text,
  "team_id" uuid,
  "inbox_id" uuid REFERENCES "channel_inboxes"("id") ON DELETE SET NULL,
  "workflow_id" uuid REFERENCES "channel_workflows"("id") ON DELETE SET NULL,
  "allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "allowed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "monthly_limit" integer,
  "auto_reply_enabled" boolean,
  "human_handoff_enabled" boolean,
  "memory_enabled" boolean,
  "files_enabled" boolean,
  "status" text DEFAULT 'active' NOT NULL,
  "force_human_handoff" boolean DEFAULT false NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_org_policy_org_unique_idx" ON "whatsapp_organization_policies" ("organization_id");
CREATE INDEX IF NOT EXISTS "whatsapp_org_policy_status_idx" ON "whatsapp_organization_policies" ("organization_id", "status");

CREATE TABLE IF NOT EXISTS "whatsapp_user_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  "model_id" text,
  "team_id" uuid,
  "inbox_id" uuid REFERENCES "channel_inboxes"("id") ON DELETE SET NULL,
  "workflow_id" uuid REFERENCES "channel_workflows"("id") ON DELETE SET NULL,
  "allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "allowed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "monthly_limit" integer,
  "auto_reply_enabled" boolean,
  "human_handoff_enabled" boolean,
  "memory_enabled" boolean,
  "files_enabled" boolean,
  "status" text DEFAULT 'active' NOT NULL,
  "force_human_handoff" boolean DEFAULT false NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_user_policy_org_user_unique_idx" ON "whatsapp_user_policies" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "whatsapp_user_policy_status_idx" ON "whatsapp_user_policies" ("organization_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "whatsapp_user_policy_user_idx" ON "whatsapp_user_policies" ("user_id");
CREATE INDEX IF NOT EXISTS "whatsapp_user_policy_force_handoff_idx" ON "whatsapp_user_policies" ("organization_id", "force_human_handoff") WHERE "force_human_handoff" = true;
