CREATE TABLE IF NOT EXISTS "whatsapp_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "whatsapp_wa_id" text,
  "whatsapp_phone_number_masked" text,
  "connection_status" text NOT NULL DEFAULT 'disconnected',
  "connected_at" timestamp with time zone,
  "disconnected_at" timestamp with time zone,
  "last_interaction_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_connections_status_check"
    CHECK ("connection_status" IN ('connected', 'disconnected')),
  CONSTRAINT "whatsapp_connections_wa_id_check"
    CHECK ("whatsapp_wa_id" IS NULL OR "whatsapp_wa_id" ~ '^[0-9]{6,20}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_connections_user_unique_idx"
  ON "whatsapp_connections" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_connections_wa_id_unique_idx"
  ON "whatsapp_connections" ("whatsapp_wa_id")
  WHERE "whatsapp_wa_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_connections_status_idx"
  ON "whatsapp_connections" ("connection_status", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_link_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_link_tokens_hash_check"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_link_tokens_user_created_idx"
  ON "whatsapp_link_tokens" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_link_tokens_expires_idx"
  ON "whatsapp_link_tokens" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_link_tokens_active_user_idx"
  ON "whatsapp_link_tokens" ("user_id", "created_at")
  WHERE "used_at" IS NULL AND "revoked_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" text NOT NULL UNIQUE,
  "phone_number_id" text,
  "event_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'accepted',
  "error_code" text,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  CONSTRAINT "whatsapp_webhook_events_status_check"
    CHECK ("status" IN ('accepted', 'completed', 'failed', 'ignored'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_received_idx"
  ON "whatsapp_webhook_events" ("received_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_status_idx"
  ON "whatsapp_webhook_events" ("status", "received_at");
