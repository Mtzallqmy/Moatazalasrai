ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "custom_permissions" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "organization_members"
  DROP CONSTRAINT IF EXISTS "organization_members_custom_permissions_array_check";

ALTER TABLE "organization_members"
  ADD CONSTRAINT "organization_members_custom_permissions_array_check"
  CHECK (jsonb_typeof("custom_permissions") = 'array');

CREATE INDEX IF NOT EXISTS "organization_members_org_expiry_idx"
  ON "organization_members" ("organization_id", "expires_at");

CREATE INDEX IF NOT EXISTS "organization_members_user_expiry_idx"
  ON "organization_members" ("user_id", "expires_at");

-- Make an already-expired access grant effective immediately after deployment.
UPDATE "sessions" AS session
SET "revoked_at" = now()
FROM "organization_members" AS membership
WHERE session."user_id" = membership."user_id"
  AND session."active_organization_id" = membership."organization_id"
  AND session."revoked_at" IS NULL
  AND membership."expires_at" IS NOT NULL
  AND membership."expires_at" <= now();

UPDATE "mobile_sessions" AS session
SET "revoked_at" = now(), "updated_at" = now()
FROM "organization_members" AS membership
WHERE session."user_id" = membership."user_id"
  AND session."organization_id" = membership."organization_id"
  AND session."revoked_at" IS NULL
  AND membership."expires_at" IS NOT NULL
  AND membership."expires_at" <= now();
