DO $$ BEGIN
  ALTER TYPE "provider_kind" ADD VALUE IF NOT EXISTS 'openai_compatible';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "provider_credentials"
  ADD COLUMN IF NOT EXISTS "base_url" text,
  ADD COLUMN IF NOT EXISTS "discovered_models" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "validation_status" text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS "last_validated_at" timestamptz;

UPDATE "provider_credentials"
SET "base_url" = CASE "provider"::text
  WHEN 'openai' THEN 'https://api.openai.com/v1'
  WHEN 'anthropic' THEN 'https://api.anthropic.com'
  WHEN 'gemini' THEN 'https://generativelanguage.googleapis.com/v1beta'
  ELSE 'https://api.openai.com/v1'
END
WHERE "base_url" IS NULL;

ALTER TABLE "provider_credentials" ALTER COLUMN "base_url" SET NOT NULL;
