CREATE TABLE IF NOT EXISTS "conversation_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "content" text NOT NULL DEFAULT '',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_drafts_content_length_check" CHECK (char_length("content") <= 30000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_drafts_conversation_user_unique_idx"
  ON "conversation_drafts" ("conversation_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_drafts_org_user_updated_idx"
  ON "conversation_drafts" ("organization_id", "user_id", "updated_at" DESC);
