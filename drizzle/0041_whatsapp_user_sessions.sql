-- Durable WhatsApp interaction state for multi-step platform flows.
CREATE TABLE IF NOT EXISTS "whatsapp_user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "whatsapp_wa_id" text NOT NULL,
  "active_flow" text,
  "current_step" text,
  "selected_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "selected_team_id" uuid,
  "selected_conversation_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + interval '30 minutes') NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_user_sessions_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_user_sessions_identity_unique_idx"
  ON "whatsapp_user_sessions" ("user_id", "organization_id", "whatsapp_wa_id");

CREATE INDEX IF NOT EXISTS "whatsapp_user_sessions_active_flow_idx"
  ON "whatsapp_user_sessions" ("organization_id", "active_flow", "expires_at");

CREATE INDEX IF NOT EXISTS "whatsapp_user_sessions_conversation_idx"
  ON "whatsapp_user_sessions" ("organization_id", "selected_conversation_id")
  WHERE "selected_conversation_id" IS NOT NULL;

-- Safe operational defaults for the real menu. Sensitive and financial operations remain blocked.
ALTER TABLE "platform_whatsapp_defaults"
  ALTER COLUMN "default_permissions" SET DEFAULT
  '["ai.chat","agent.use","account.read","conversation.open","files.use","handoff.request"]'::jsonb;

UPDATE "platform_whatsapp_defaults"
SET "default_permissions" = (
  SELECT jsonb_agg(value ORDER BY value)
  FROM (
    SELECT DISTINCT jsonb_array_elements_text(
      COALESCE("platform_whatsapp_defaults"."default_permissions", '[]'::jsonb)
      || '["ai.chat","agent.use","account.read","conversation.open","files.use","handoff.request"]'::jsonb
    ) AS value
  ) AS permissions
), "updated_at" = now();
