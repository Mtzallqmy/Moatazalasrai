-- Durable Telegram update processing and multi-step user sessions.
ALTER TABLE "telegram_updates"
  ADD COLUMN IF NOT EXISTS "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "processing_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "queued_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_processed_at" timestamptz;

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
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "telegram_user_sessions_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_user_sessions_telegram_chat_unique_idx"
  ON "telegram_user_sessions" ("telegram_user_id", "telegram_chat_id");
CREATE INDEX IF NOT EXISTS "telegram_user_sessions_user_org_idx"
  ON "telegram_user_sessions" ("user_id", "organization_id", "updated_at");
CREATE INDEX IF NOT EXISTS "telegram_user_sessions_expiry_idx"
  ON "telegram_user_sessions" ("expires_at");

COMMENT ON TABLE "telegram_user_sessions" IS
  'Durable optimistic-locking state for central Telegram navigation and multi-step flows';
COMMENT ON COLUMN "telegram_updates"."payload" IS
  'Validated Telegram update payload retained for idempotent Graphile Worker processing';
