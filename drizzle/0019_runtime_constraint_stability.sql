DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_team_runs_organization_id_request_id_key'
      AND conrelid = 'public.agent_team_runs'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_team_runs_org_request_idx'
      AND conrelid = 'public.agent_team_runs'::regclass
  ) THEN
    ALTER TABLE "agent_team_runs"
      RENAME CONSTRAINT "agent_team_runs_organization_id_request_id_key"
      TO "agent_team_runs_org_request_idx";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "agent_versions"
  DROP CONSTRAINT IF EXISTS "agent_versions_provider_credential_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent_versions"
  ADD CONSTRAINT "agent_versions_provider_credential_id_fkey"
  FOREIGN KEY ("provider_credential_id")
  REFERENCES "public"."provider_credentials"("id")
  DEFERRABLE INITIALLY DEFERRED;
