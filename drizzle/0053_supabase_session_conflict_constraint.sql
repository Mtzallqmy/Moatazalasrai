-- PostgreSQL cannot infer a partial unique index for
-- ON CONFLICT (supabase_session_id) unless the same predicate is present.
-- A regular unique index still permits multiple NULL values and therefore
-- matches both the Drizzle schema and the application upsert exactly.
DROP INDEX IF EXISTS "sessions_supabase_session_id_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_supabase_session_id_unique_idx"
  ON "sessions" ("supabase_session_id");
