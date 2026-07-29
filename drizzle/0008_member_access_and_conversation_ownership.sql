ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'member';

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "public_registration_enabled" boolean NOT NULL DEFAULT false;

UPDATE "organizations"
SET "public_registration_enabled" = true
WHERE "id" = (
  SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "organizations" WHERE "public_registration_enabled" = true
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_single_public_registration_idx"
  ON "organizations" ("public_registration_enabled")
  WHERE "public_registration_enabled" = true;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

WITH organization_owners AS (
  SELECT DISTINCT ON ("organization_id") "organization_id", "user_id"
  FROM "organization_members"
  WHERE "role" IN ('owner', 'admin')
  ORDER BY "organization_id", CASE WHEN "role" = 'owner' THEN 0 ELSE 1 END, "created_at"
)
UPDATE "conversations" AS conversations
SET "created_by_user_id" = owners."user_id"
FROM organization_owners AS owners
WHERE conversations."organization_id" = owners."organization_id"
  AND conversations."created_by_user_id" IS NULL;

CREATE INDEX IF NOT EXISTS "conversations_org_creator_updated_idx"
  ON "conversations" ("organization_id", "created_by_user_id", "updated_at");
