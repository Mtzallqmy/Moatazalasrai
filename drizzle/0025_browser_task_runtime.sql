ALTER TABLE "browser_tasks" ADD COLUMN IF NOT EXISTS "encrypted_plan" text;
--> statement-breakpoint
ALTER TABLE "browser_tasks" ADD COLUMN IF NOT EXISTS "external_task_id" text;
--> statement-breakpoint
ALTER TABLE "browser_tasks" ADD COLUMN IF NOT EXISTS "runner_event_sequence" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_tasks_external_task_unique_idx"
  ON "browser_tasks" ("external_task_id") WHERE "external_task_id" IS NOT NULL;
