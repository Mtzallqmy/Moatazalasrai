DO $$ BEGIN
  CREATE TYPE "integration_kind" AS ENUM ('telegram', 'github');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "integration_status" AS ENUM ('pending', 'verified', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "attachment_source" AS ENUM ('web', 'api', 'telegram');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" integration_kind NOT NULL,
  "name" text NOT NULL,
  "encrypted_token" text NOT NULL,
  "token_hint" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" integration_status NOT NULL DEFAULT 'pending',
  "enabled" boolean NOT NULL DEFAULT true,
  "last_verified_at" timestamptz,
  "last_error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "integrations_org_kind_name_unique_idx"
  ON "integrations" ("organization_id", "kind", "name");
CREATE INDEX IF NOT EXISTS "integrations_org_kind_status_idx"
  ON "integrations" ("organization_id", "kind", "status", "enabled");

CREATE TABLE IF NOT EXISTS "telegram_chats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "integration_id" uuid NOT NULL REFERENCES "integrations"("id") ON DELETE CASCADE,
  "telegram_chat_id" text NOT NULL,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "username" text,
  "title" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_message_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_chats_integration_chat_unique_idx"
  ON "telegram_chats" ("integration_id", "telegram_chat_id");
CREATE INDEX IF NOT EXISTS "telegram_chats_org_updated_idx"
  ON "telegram_chats" ("organization_id", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "telegram_updates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "integration_id" uuid NOT NULL REFERENCES "integrations"("id") ON DELETE CASCADE,
  "update_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'accepted',
  "error_code" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_updates_integration_update_unique_idx"
  ON "telegram_updates" ("integration_id", "update_id");
CREATE INDEX IF NOT EXISTS "telegram_updates_received_idx"
  ON "telegram_updates" ("received_at");

CREATE TABLE IF NOT EXISTS "attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE CASCADE,
  "message_id" uuid REFERENCES "messages"("id") ON DELETE SET NULL,
  "uploaded_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source" attachment_source NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "content" bytea NOT NULL,
  "telegram_file_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachments_size_check" CHECK ("size_bytes" >= 0 AND "size_bytes" <= 10485760)
);

CREATE INDEX IF NOT EXISTS "attachments_org_created_idx"
  ON "attachments" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "attachments_conversation_idx"
  ON "attachments" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "attachments_message_idx"
  ON "attachments" ("message_id");
CREATE INDEX IF NOT EXISTS "attachments_sha256_idx"
  ON "attachments" ("organization_id", "sha256");
