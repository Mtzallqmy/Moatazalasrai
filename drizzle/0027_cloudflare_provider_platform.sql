ALTER TABLE "provider_credentials"
  ALTER COLUMN "encrypted_secret" DROP NOT NULL,
  ALTER COLUMN "secret_hint" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "provider_type_id" text,
  ADD COLUMN IF NOT EXISTS "transport_mode" text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS "credential_mode" text NOT NULL DEFAULT 'encrypted_byok',
  ADD COLUMN IF NOT EXISTS "gateway_id" text,
  ADD COLUMN IF NOT EXISTS "key_alias" text,
  ADD COLUMN IF NOT EXISTS "gateway_skip_cache" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "gateway_cache_ttl" integer,
  ADD COLUMN IF NOT EXISTS "gateway_collect_log" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "default_model" text,
  ADD COLUMN IF NOT EXISTS "allowed_models" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "health_status" text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_successful_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_failure_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_error_category" text,
  ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "provider_credentials"
SET "provider_type_id" = CASE "provider"
  WHEN 'openai' THEN 'openai'
  WHEN 'anthropic' THEN 'anthropic'
  WHEN 'gemini' THEN 'google-ai-studio'
  ELSE 'custom-openai-compatible'
END
WHERE "provider_type_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "provider_credentials"
  ALTER COLUMN "provider_type_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_transport_mode_check"
  CHECK ("transport_mode" IN ('direct', 'cloudflare_ai_gateway_native', 'cloudflare_ai_gateway_rest', 'cloudflare_workers_ai'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_credential_mode_check"
  CHECK ("credential_mode" IN ('encrypted_byok', 'cloudflare_provider_key', 'cloudflare_binding'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_health_status_check"
  CHECK ("health_status" IN ('unconfigured', 'validating', 'healthy', 'degraded', 'rate_limited', 'unauthorized', 'model_unavailable', 'network_error', 'misconfigured', 'disabled', 'unknown'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credentials_one_default_per_org_idx"
  ON "provider_credentials" ("organization_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_credentials_org_health_idx"
  ON "provider_credentials" ("organization_id", "health_status", "enabled")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "summary" text,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "provider_credential_id" uuid,
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "last_message_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_status_check"
  CHECK ("status" IN ('active', 'archived', 'deleted'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_provider_credential_id_fk"
  FOREIGN KEY ("provider_credential_id") REFERENCES "provider_credentials"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_org_last_message_idx"
  ON "conversations" ("organization_id", "last_message_at" DESC NULLS LAST, "updated_at" DESC);
--> statement-breakpoint
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "content_parts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS "request_id" text,
  ADD COLUMN IF NOT EXISTS "input_tokens" integer,
  ADD COLUMN IF NOT EXISTS "output_tokens" integer,
  ADD COLUMN IF NOT EXISTS "latency_ms" integer,
  ADD COLUMN IF NOT EXISTS "error_code" text,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_status_check"
  CHECK ("status" IN ('sending', 'streaming', 'completed', 'failed', 'interrupted', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_status_created_idx"
  ON "messages" ("conversation_id", "status", "created_at");
--> statement-breakpoint
ALTER TABLE "provider_credential_health_events"
  ADD COLUMN IF NOT EXISTS "error_category" text,
  ADD COLUMN IF NOT EXISTS "request_id" text,
  ADD COLUMN IF NOT EXISTS "provider_request_id" text,
  ADD COLUMN IF NOT EXISTS "latency_ms" integer;
--> statement-breakpoint
ALTER TABLE "provider_validation_sessions"
  ALTER COLUMN "api_key_hash" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "provider_type_id" text,
  ADD COLUMN IF NOT EXISTS "transport_mode" text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS "credential_mode" text NOT NULL DEFAULT 'encrypted_byok',
  ADD COLUMN IF NOT EXISTS "gateway_id" text,
  ADD COLUMN IF NOT EXISTS "key_alias" text,
  ADD COLUMN IF NOT EXISTS "config_hash" text;
--> statement-breakpoint
UPDATE "provider_validation_sessions"
SET "provider_type_id" = CASE "provider"
  WHEN 'openai' THEN 'openai'
  WHEN 'anthropic' THEN 'anthropic'
  WHEN 'gemini' THEN 'google-ai-studio'
  ELSE 'custom-openai-compatible'
END
WHERE "provider_type_id" IS NULL;
--> statement-breakpoint
UPDATE "conversations"
SET "last_message_at" = COALESCE("last_message_at", "updated_at")
WHERE "last_message_at" IS NULL;
--> statement-breakpoint
UPDATE "messages"
SET "completed_at" = COALESCE("completed_at", "created_at")
WHERE "status" = 'completed' AND "completed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "provider_validation_sessions"
  ALTER COLUMN "provider_type_id" SET NOT NULL;

