DO $$ BEGIN
  CREATE TYPE "browser_login_status" AS ENUM ('active', 'completed', 'cancelled', 'expired', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browser_login_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "site_connection_id" uuid NOT NULL REFERENCES "site_connections"("id") ON DELETE cascade,
  "external_session_id" text NOT NULL,
  "status" "browser_login_status" DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_login_sessions_external_unique_idx" ON "browser_login_sessions" ("external_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_login_sessions_org_connection_idx" ON "browser_login_sessions" ("organization_id", "site_connection_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_login_sessions_expiry_idx" ON "browser_login_sessions" ("expires_at");
