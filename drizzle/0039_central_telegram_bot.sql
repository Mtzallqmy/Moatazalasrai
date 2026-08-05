CREATE TABLE IF NOT EXISTS "telegram_account_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "telegram_user_id" text NOT NULL,
  "telegram_chat_id" text NOT NULL,
  "telegram_username" text,
  "telegram_first_name" text,
  "telegram_last_name" text,
  "status" text DEFAULT 'active' NOT NULL,
  "linked_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_account_links_user_unique_idx" ON "telegram_account_links" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_account_links_telegram_user_unique_idx" ON "telegram_account_links" ("telegram_user_id");
CREATE INDEX IF NOT EXISTS "telegram_account_links_org_status_idx" ON "telegram_account_links" ("organization_id", "status", "updated_at");

CREATE TABLE IF NOT EXISTS "telegram_link_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer NOT NULL,
  "consumed_at" timestamptz,
  "revoked_at" timestamptz,
  "request_ip_hash" text,
  "user_agent_hash" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_link_codes_hash_unique_idx" ON "telegram_link_codes" ("code_hash");
CREATE INDEX IF NOT EXISTS "telegram_link_codes_user_created_idx" ON "telegram_link_codes" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "telegram_link_codes_expires_idx" ON "telegram_link_codes" ("expires_at");
CREATE INDEX IF NOT EXISTS "telegram_link_codes_hash_expires_idx" ON "telegram_link_codes" ("code_hash", "expires_at");

CREATE TABLE IF NOT EXISTS "telegram_feature_permissions" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "feature_key" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "telegram_feature_permissions_user_feature_pk" PRIMARY KEY ("user_id", "feature_key")
);
CREATE INDEX IF NOT EXISTS "telegram_feature_permissions_org_user_idx" ON "telegram_feature_permissions" ("organization_id", "user_id");

ALTER TABLE "telegram_updates" ALTER COLUMN "integration_id" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_updates_central_update_unique_idx"
  ON "telegram_updates" ("update_id") WHERE "integration_id" IS NULL;

-- Legacy per-organization Telegram integrations remain readable for history but are no longer used by the central webhook.
COMMENT ON TABLE "telegram_account_links" IS 'Central platform Telegram bot account links';
