CREATE TABLE IF NOT EXISTS "whatsapp_user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "whatsapp_wa_id" text NOT NULL,
  "whatsapp_chat_id" text NOT NULL,
  "active_flow" text,
  "current_step" text,
  "selected_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "selected_team_id" uuid REFERENCES "agent_teams"("id") ON DELETE SET NULL,
  "selected_conversation_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
  "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_user_sessions_user_unique_idx"
  ON "whatsapp_user_sessions" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_user_sessions_wa_id_unique_idx"
  ON "whatsapp_user_sessions" ("whatsapp_wa_id");
CREATE INDEX IF NOT EXISTS "whatsapp_user_sessions_org_updated_idx"
  ON "whatsapp_user_sessions" ("organization_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "whatsapp_user_sessions_expiry_idx"
  ON "whatsapp_user_sessions" ("expires_at") WHERE "expires_at" IS NOT NULL;
