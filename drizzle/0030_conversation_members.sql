DO $$ BEGIN
  CREATE TYPE "conversation_member_role" AS ENUM ('reader', 'writer', 'manager');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "conversation_member_role" NOT NULL DEFAULT 'reader',
  "added_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_members_conversation_user_unique_idx"
  ON "conversation_members" ("conversation_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_members_org_user_idx"
  ON "conversation_members" ("organization_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_members_conversation_role_idx"
  ON "conversation_members" ("conversation_id", "role");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_author_user_idx" ON "messages" ("author_user_id", "created_at");
--> statement-breakpoint
INSERT INTO "conversation_members" ("organization_id", "conversation_id", "user_id", "role", "added_by_user_id")
SELECT c."organization_id", c."id", c."created_by_user_id", 'manager'::"conversation_member_role", c."created_by_user_id"
FROM "conversations" c
WHERE c."created_by_user_id" IS NOT NULL
ON CONFLICT ("conversation_id", "user_id") DO UPDATE SET "role" = 'manager', "updated_at" = now();
--> statement-breakpoint
UPDATE "messages" m
SET "author_user_id" = c."created_by_user_id"
FROM "conversations" c
WHERE m."conversation_id" = c."id"
  AND m."role" = 'user'
  AND m."author_user_id" IS NULL;
