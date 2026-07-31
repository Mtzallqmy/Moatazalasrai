ALTER TABLE "agent_team_run_steps"
  ADD COLUMN IF NOT EXISTS "conversation_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_team_run_steps"
  ADD CONSTRAINT "agent_team_run_steps_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "runs_org_team_request_unique_idx"
  ON "runs" USING btree ("organization_id", "request_id")
  WHERE "request_id" LIKE 'team:%';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_team_client_request_unique_idx"
  ON "messages" USING btree ("conversation_id", "client_request_id")
  WHERE "client_request_id" LIKE 'team:%';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_team_run_steps_conversation_idx"
  ON "agent_team_run_steps" USING btree ("conversation_id")
  WHERE "conversation_id" IS NOT NULL;
