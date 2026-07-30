ALTER TABLE "provider_credentials"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_credentials_org_active_idx"
  ON "provider_credentials" USING btree ("organization_id", "enabled", "validation_status")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_credentials_deleted_at_idx"
  ON "provider_credentials" USING btree ("deleted_at")
  WHERE "deleted_at" IS NOT NULL;
