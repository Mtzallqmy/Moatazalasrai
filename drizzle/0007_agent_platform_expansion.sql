DO $$ BEGIN CREATE TYPE "memory_kind" AS ENUM ('semantic','procedural','episodic'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "document_status" AS ENUM ('uploaded','processing','ready','failed','deleted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "job_status" AS ENUM ('queued','running','completed','failed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "tool_approval_status" AS ENUM ('pending','approved','rejected','consumed','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "agent_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE CASCADE,
  "kind" memory_kind NOT NULL, "content" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "importance_milli" integer NOT NULL DEFAULT 500 CHECK ("importance_milli" BETWEEN 0 AND 1000),
  "enabled" boolean NOT NULL DEFAULT true, "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "agent_memories_scope_idx" ON "agent_memories" ("organization_id","user_id","agent_id","enabled");

CREATE TABLE IF NOT EXISTS "knowledge_bases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL, "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id","name")
);
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "knowledge_base_id" uuid NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "attachment_id" uuid NOT NULL REFERENCES "attachments"("id") ON DELETE CASCADE,
  "title" text NOT NULL, "mime_type" text NOT NULL, "byte_size" integer NOT NULL CHECK ("byte_size" >= 0),
  "checksum_sha256" text NOT NULL, "status" document_status NOT NULL DEFAULT 'uploaded',
  "error_code" text, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organization_id","knowledge_base_id","checksum_sha256")
);
CREATE INDEX IF NOT EXISTS "knowledge_documents_scope_idx" ON "knowledge_documents" ("organization_id","knowledge_base_id","status");
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL CHECK ("chunk_index" >= 0), "content" text NOT NULL,
  "token_estimate" integer NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(), UNIQUE ("document_id","chunk_index")
);
CREATE INDEX IF NOT EXISTS "knowledge_chunks_scope_idx" ON "knowledge_chunks" ("organization_id","document_id");

CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "type" text NOT NULL, "status" job_status NOT NULL DEFAULT 'queued',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb, "result" jsonb,
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "max_attempts" integer NOT NULL DEFAULT 5 CHECK ("max_attempts" > 0),
  "available_at" timestamptz NOT NULL DEFAULT now(), "locked_at" timestamptz, "locked_by" text,
  "last_error_code" text, "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "background_jobs_claim_idx" ON "background_jobs" ("status","available_at","locked_at");
CREATE INDEX IF NOT EXISTS "background_jobs_scope_idx" ON "background_jobs" ("organization_id","created_at");

CREATE TABLE IF NOT EXISTS "tool_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE CASCADE,
  "tool_id" text NOT NULL, "input_digest" text NOT NULL,
  "status" tool_approval_status NOT NULL DEFAULT 'pending',
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamptz NOT NULL, "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tool_approvals_scope_idx" ON "tool_approvals" ("organization_id","status","expires_at");
