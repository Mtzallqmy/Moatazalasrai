DO $$ BEGIN
  CREATE TYPE "file_processing_status" AS ENUM ('pending', 'processing', 'ready', 'failed', 'quarantined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "conversation_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "archived_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "conversation_folders_org_updated_idx" ON "conversation_folders" ("organization_id", "updated_at" DESC);

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "folder_id" uuid REFERENCES "conversation_folders"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
CREATE INDEX IF NOT EXISTS "conversations_org_folder_updated_idx" ON "conversations" ("organization_id", "folder_id", "updated_at" DESC);

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "parent_message_id" uuid REFERENCES "messages"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "client_request_id" text,
  ADD COLUMN IF NOT EXISTS "provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "edited_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS "messages_conversation_client_request_unique_idx"
  ON "messages" ("conversation_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "messages_parent_idx" ON "messages" ("parent_message_id");

ALTER TABLE "attachments"
  ADD COLUMN IF NOT EXISTS "detected_type" text,
  ADD COLUMN IF NOT EXISTS "processing_status" file_processing_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "extracted_text" text,
  ADD COLUMN IF NOT EXISTS "processing_error_code" text,
  ADD COLUMN IF NOT EXISTS "archive_entry_count" integer,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS "attachments_org_status_created_idx"
  ON "attachments" ("organization_id", "processing_status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "model_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider_credential_id" uuid NOT NULL REFERENCES "provider_credentials"("id") ON DELETE CASCADE,
  "model" text NOT NULL,
  "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "context_window" integer,
  "max_output_tokens" integer,
  "free_tier_eligible" boolean NOT NULL DEFAULT false,
  "available" boolean NOT NULL DEFAULT true,
  "latency_ms" integer,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "model_catalog_provider_model_unique_idx" ON "model_catalog" ("provider_credential_id", "model");
CREATE INDEX IF NOT EXISTS "model_catalog_org_available_idx" ON "model_catalog" ("organization_id", "available", "free_tier_eligible");

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "default_provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "default_model" text;

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "default_provider_credential_id" uuid REFERENCES "provider_credentials"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "default_model" text;
