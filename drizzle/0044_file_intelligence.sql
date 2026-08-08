-- File Intelligence Layer for conversation attachments. Additive and backward-compatible.
CREATE TABLE IF NOT EXISTS "attachment_intelligence" (
  "attachment_id" uuid PRIMARY KEY REFERENCES "attachments"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'uploaded',
  "detected_type" text NOT NULL,
  "category" text NOT NULL,
  "extraction_version" text NOT NULL DEFAULT 'file-intelligence-v1',
  "extracted_chars" integer NOT NULL DEFAULT 0,
  "chunk_count" integer NOT NULL DEFAULT 0,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "extracted_at" timestamptz,
  "indexed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachment_intelligence_status_check" CHECK ("status" IN ('uploaded','processing','ready','partially_ready','failed','unsupported')),
  CONSTRAINT "attachment_intelligence_counts_check" CHECK ("extracted_chars" >= 0 AND "chunk_count" >= 0)
);
CREATE INDEX IF NOT EXISTS "attachment_intelligence_org_status_idx" ON "attachment_intelligence" ("organization_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "attachment_intelligence_conversation_idx" ON "attachment_intelligence" ("organization_id", "conversation_id", "updated_at");

CREATE TABLE IF NOT EXISTS "attachment_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE CASCADE,
  "attachment_id" uuid NOT NULL REFERENCES "attachments"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "token_estimate" integer NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachment_chunks_index_check" CHECK ("chunk_index" >= 0),
  CONSTRAINT "attachment_chunks_content_check" CHECK (octet_length("content") BETWEEN 1 AND 262144),
  CONSTRAINT "attachment_chunks_tokens_check" CHECK ("token_estimate" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "attachment_chunks_attachment_index_unique_idx" ON "attachment_chunks" ("attachment_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "attachment_chunks_scope_idx" ON "attachment_chunks" ("organization_id", "conversation_id", "attachment_id");

-- Backfill intelligence metadata for existing attachments without pretending they were truly indexed.
INSERT INTO "attachment_intelligence" (
  "attachment_id", "organization_id", "conversation_id", "status", "detected_type", "category",
  "extracted_chars", "chunk_count", "warnings", "metadata", "extracted_at", "indexed_at"
)
SELECT
  a."id", a."organization_id", a."conversation_id",
  CASE
    WHEN a."processing_status" = 'failed' THEN 'failed'
    WHEN a."processing_status" = 'quarantined' THEN 'failed'
    WHEN coalesce(length(a."extracted_text"), 0) > 0 THEN 'partially_ready'
    ELSE 'unsupported'
  END,
  coalesce(a."detected_type", a."mime_type"),
  CASE
    WHEN a."mime_type" LIKE 'image/%' THEN 'image'
    WHEN a."mime_type" = 'application/pdf' THEN 'document'
    WHEN a."mime_type" LIKE 'text/%' OR a."mime_type" IN ('application/json') THEN 'text'
    WHEN a."mime_type" LIKE '%spreadsheet%' THEN 'spreadsheet'
    WHEN a."mime_type" LIKE '%presentation%' THEN 'presentation'
    WHEN a."mime_type" LIKE '%wordprocessing%' THEN 'document'
    WHEN a."mime_type" IN ('application/zip','application/vnd.rar','application/x-rar-compressed','application/x-7z-compressed') THEN 'archive'
    WHEN a."mime_type" LIKE 'audio/%' THEN 'audio'
    WHEN a."mime_type" LIKE 'video/%' THEN 'video'
    ELSE 'binary'
  END,
  coalesce(length(a."extracted_text"), 0), 0,
  CASE WHEN coalesce(length(a."extracted_text"), 0) > 0 THEN '["LEGACY_NOT_CHUNK_INDEXED"]'::jsonb ELSE '["LEGACY_EXTRACTION_UNVERIFIED"]'::jsonb END,
  '{"backfilled":true}'::jsonb,
  CASE WHEN coalesce(length(a."extracted_text"), 0) > 0 THEN a."updated_at" ELSE NULL END,
  NULL
FROM "attachments" a
ON CONFLICT ("attachment_id") DO NOTHING;
