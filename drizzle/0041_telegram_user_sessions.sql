CREATE TABLE IF NOT EXISTS "telegram_user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "telegram_user_id" text NOT NULL,
  "telegram_chat_id" text NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_user_sessions_user_unique_idx"
  ON "telegram_user_sessions" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_user_sessions_telegram_unique_idx"
  ON "telegram_user_sessions" ("telegram_user_id");
CREATE INDEX IF NOT EXISTS "telegram_user_sessions_org_updated_idx"
  ON "telegram_user_sessions" ("organization_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "telegram_user_sessions_expiry_idx"
  ON "telegram_user_sessions" ("expires_at") WHERE "expires_at" IS NOT NULL;
