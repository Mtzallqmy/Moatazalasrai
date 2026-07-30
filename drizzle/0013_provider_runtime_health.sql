CREATE TABLE IF NOT EXISTS "provider_credential_health_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "provider_credential_id" uuid NOT NULL,
  "run_id" uuid,
  "outcome" text NOT NULL,
  "model" text NOT NULL,
  "error_code" text,
  "provider_status" integer,
  "retryable" boolean,
  "circuit_open_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_credential_health_events" ADD CONSTRAINT "provider_credential_health_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_credential_health_events" ADD CONSTRAINT "provider_credential_health_events_provider_credential_id_provider_credentials_id_fk" FOREIGN KEY ("provider_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_credential_health_events" ADD CONSTRAINT "provider_credential_health_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_health_events_org_created_idx" ON "provider_credential_health_events" USING btree ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_health_events_credential_created_idx" ON "provider_credential_health_events" USING btree ("provider_credential_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_health_events_run_idx" ON "provider_credential_health_events" USING btree ("run_id");
