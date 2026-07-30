CREATE TABLE IF NOT EXISTS "provider_validation_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" "provider_kind" NOT NULL,
  "provider_slug" text NOT NULL,
  "normalized_base_url" text NOT NULL,
  "api_key_hash" text NOT NULL,
  "models" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tested_model" text NOT NULL,
  "latency_ms" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "provider_validation_sessions_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "provider_validation_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_validation_sessions_scope_idx"
  ON "provider_validation_sessions" USING btree ("organization_id", "user_id", "expires_at")
  WHERE "consumed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_validation_sessions_expiry_idx"
  ON "provider_validation_sessions" USING btree ("expires_at");
