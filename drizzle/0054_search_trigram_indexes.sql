-- migrate:no-transaction
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- These partial GIN indexes match the production substring-search predicates.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_content_trgm_idx"
  ON "messages" USING gin ("content" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_title_trgm_idx"
  ON "conversations" USING gin ("title" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_summary_trgm_idx"
  ON "conversations" USING gin ("summary" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "attachments_filename_trgm_idx"
  ON "attachments" USING gin ("filename" gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "agents_name_trgm_idx"
  ON "agents" USING gin ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "agents_description_trgm_idx"
  ON "agents" USING gin ("description" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "knowledge_bases_name_trgm_idx"
  ON "knowledge_bases" USING gin ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "knowledge_bases_description_trgm_idx"
  ON "knowledge_bases" USING gin ("description" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "runs_model_trgm_idx"
  ON "runs" USING gin ("model" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "runs_request_id_trgm_idx"
  ON "runs" USING gin ("request_id" gin_trgm_ops);
