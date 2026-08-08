-- Supabase owns authentication. Railway PostgreSQL retains the local user,
-- organization, RBAC and per-session active organization context.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supabase_user_id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_linked_at" timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS "users_supabase_user_id_unique_idx"
  ON "users" ("supabase_user_id") WHERE "supabase_user_id" IS NOT NULL;

ALTER TABLE "sessions" ALTER COLUMN "token_hash" DROP NOT NULL;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "supabase_session_id" uuid;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "auth_source" text NOT NULL DEFAULT 'legacy';
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_supabase_session_id_unique_idx"
  ON "sessions" ("supabase_session_id") WHERE "supabase_session_id" IS NOT NULL;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auth_identity_check"
  CHECK (
    ("auth_source" = 'legacy' AND "token_hash" IS NOT NULL)
    OR ("auth_source" = 'supabase' AND "supabase_session_id" IS NOT NULL)
  ) NOT VALID;
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_auth_identity_check";
