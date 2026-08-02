CREATE TABLE IF NOT EXISTS "site_oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "site_connection_id" uuid NOT NULL REFERENCES "site_connections"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "state_hash" text NOT NULL,
  "nonce_hash" text NOT NULL,
  "encrypted_code_verifier" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "requested_scopes" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_oauth_states_state_hash_unique_idx" ON "site_oauth_states" ("state_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_oauth_states_org_connection_idx" ON "site_oauth_states" ("organization_id", "site_connection_id", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_oauth_states_expiry_idx" ON "site_oauth_states" ("expires_at");
