-- Additive channel platform for Telegram and WhatsApp routing, permissions, handoff, and idempotency.
DO $$ BEGIN
  CREATE TYPE "channel_kind" AS ENUM ('telegram', 'whatsapp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "channel_conversation_mode" AS ENUM (
    'ai', 'human', 'ai_then_human', 'human_then_ai', 'keyword',
    'business_hours', 'agent_failure', 'user_request'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "channel_connection_status" AS ENUM ('pending', 'healthy', 'degraded', 'disabled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "channel_event_status" AS ENUM ('accepted', 'processing', 'completed', 'failed', 'ignored');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "channel_handoff_status" AS ENUM ('requested', 'assigned', 'resolved', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "channel_inboxes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_inboxes_org_name_unique_idx" ON "channel_inboxes" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "channel_inboxes_org_enabled_idx" ON "channel_inboxes" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "channel_inbox_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "inbox_id" uuid NOT NULL REFERENCES "channel_inboxes"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "priority" integer NOT NULL DEFAULT 100,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_inbox_members_inbox_user_unique_idx" ON "channel_inbox_members" ("inbox_id", "user_id");
CREATE INDEX IF NOT EXISTS "channel_inbox_members_org_enabled_idx" ON "channel_inbox_members" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "channel_workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "trigger" text NOT NULL DEFAULT 'incoming_message',
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_workflows_org_name_unique_idx" ON "channel_workflows" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "channel_workflows_org_enabled_idx" ON "channel_workflows" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "channel_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" "channel_kind" NOT NULL,
  "integration_id" uuid REFERENCES "integrations"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "external_account_id" text NOT NULL,
  "display_address" text,
  "credential_source" text NOT NULL DEFAULT 'environment',
  "default_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "default_provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  "default_model" text,
  "inbox_id" uuid REFERENCES "channel_inboxes"("id") ON DELETE SET NULL,
  "workflow_id" uuid REFERENCES "channel_workflows"("id") ON DELETE SET NULL,
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" "channel_connection_status" NOT NULL DEFAULT 'pending',
  "enabled" boolean NOT NULL DEFAULT true,
  "webhook_status" text NOT NULL DEFAULT 'unknown',
  "webhook_last_verified_at" timestamptz,
  "last_health_at" timestamptz,
  "last_error_code" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_connections_org_kind_external_unique_idx" ON "channel_connections" ("organization_id", "kind", "external_account_id");
CREATE INDEX IF NOT EXISTS "channel_connections_org_kind_enabled_idx" ON "channel_connections" ("organization_id", "kind", "enabled");
CREATE INDEX IF NOT EXISTS "channel_connections_agent_idx" ON "channel_connections" ("default_agent_id");
CREATE INDEX IF NOT EXISTS "channel_connections_provider_idx" ON "channel_connections" ("default_provider_credential_id");

CREATE TABLE IF NOT EXISTS "channel_agent_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  "model" text,
  "priority" integer NOT NULL DEFAULT 100,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_agent_bindings_connection_agent_unique_idx" ON "channel_agent_bindings" ("connection_id", "agent_id");
CREATE INDEX IF NOT EXISTS "channel_agent_bindings_org_enabled_idx" ON "channel_agent_bindings" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "channel_provider_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "provider_credential_id" uuid NOT NULL REFERENCES "provider_credentials"("id") ON DELETE CASCADE,
  "model" text,
  "priority" integer NOT NULL DEFAULT 100,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_provider_bindings_connection_provider_unique_idx" ON "channel_provider_bindings" ("connection_id", "provider_credential_id");
CREATE INDEX IF NOT EXISTS "channel_provider_bindings_org_enabled_idx" ON "channel_provider_bindings" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "channel_tool_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "tool_id" uuid NOT NULL REFERENCES "mcp_tools"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_tool_bindings_connection_tool_unique_idx" ON "channel_tool_bindings" ("connection_id", "tool_id");
CREATE INDEX IF NOT EXISTS "channel_tool_bindings_org_enabled_idx" ON "channel_tool_bindings" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "channel_permissions" (
  "connection_id" uuid PRIMARY KEY REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "blocked_operations" jsonb NOT NULL DEFAULT '["financial", "sensitive"]'::jsonb,
  "allowed_commands" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "channel_permissions_org_idx" ON "channel_permissions" ("organization_id");

CREATE TABLE IF NOT EXISTS "channel_routing_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "condition_type" text NOT NULL,
  "condition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "action" text NOT NULL,
  "action_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "priority" integer NOT NULL DEFAULT 100,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_routing_rules_connection_name_unique_idx" ON "channel_routing_rules" ("connection_id", "name");
CREATE INDEX IF NOT EXISTS "channel_routing_rules_connection_priority_idx" ON "channel_routing_rules" ("connection_id", "enabled", "priority");

CREATE TABLE IF NOT EXISTS "channel_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" "channel_kind" NOT NULL,
  "external_id" text NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "display_name" text,
  "locale" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_contacts_org_kind_external_unique_idx" ON "channel_contacts" ("organization_id", "kind", "external_id");
CREATE INDEX IF NOT EXISTS "channel_contacts_user_idx" ON "channel_contacts" ("user_id");

CREATE TABLE IF NOT EXISTS "channel_conversation_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "channel_contacts"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "mode" "channel_conversation_mode" NOT NULL DEFAULT 'ai',
  "inbox_id" uuid REFERENCES "channel_inboxes"("id") ON DELETE SET NULL,
  "assigned_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'active',
  "last_external_message_id" text,
  "last_message_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_conversation_links_connection_contact_unique_idx" ON "channel_conversation_links" ("connection_id", "contact_id");
CREATE INDEX IF NOT EXISTS "channel_conversation_links_org_status_idx" ON "channel_conversation_links" ("organization_id", "status", "last_message_at");
CREATE INDEX IF NOT EXISTS "channel_conversation_links_conversation_idx" ON "channel_conversation_links" ("conversation_id");

CREATE TABLE IF NOT EXISTS "channel_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "external_event_id" text NOT NULL,
  "direction" text NOT NULL,
  "event_type" text NOT NULL,
  "status" "channel_event_status" NOT NULL DEFAULT 'accepted',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_events_connection_external_direction_unique_idx" ON "channel_events" ("connection_id", "external_event_id", "direction");
CREATE INDEX IF NOT EXISTS "channel_events_org_status_received_idx" ON "channel_events" ("organization_id", "status", "received_at");

CREATE TABLE IF NOT EXISTS "channel_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "conversation_link_id" uuid NOT NULL REFERENCES "channel_conversation_links"("id") ON DELETE CASCADE,
  "from_mode" "channel_conversation_mode" NOT NULL,
  "to_mode" "channel_conversation_mode" NOT NULL,
  "reason" text NOT NULL,
  "requested_by" text NOT NULL DEFAULT 'system',
  "assigned_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" "channel_handoff_status" NOT NULL DEFAULT 'requested',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "channel_handoffs_org_status_idx" ON "channel_handoffs" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "channel_handoffs_link_idx" ON "channel_handoffs" ("conversation_link_id");
