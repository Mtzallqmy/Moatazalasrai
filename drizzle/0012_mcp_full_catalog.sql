CREATE TABLE IF NOT EXISTS "mcp_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "server_id" uuid NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "uri" text NOT NULL,
  "name" text NOT NULL,
  "title" text,
  "description" text,
  "mime_type" text,
  "size_bytes" integer,
  "annotations" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "icons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_resources_server_uri_idx" ON "mcp_resources" ("server_id", "uri");
CREATE INDEX IF NOT EXISTS "mcp_resources_org_enabled_idx" ON "mcp_resources" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "mcp_resource_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "server_id" uuid NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "uri_template" text NOT NULL,
  "name" text NOT NULL,
  "title" text,
  "description" text,
  "mime_type" text,
  "annotations" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "icons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_resource_templates_server_uri_idx" ON "mcp_resource_templates" ("server_id", "uri_template");
CREATE INDEX IF NOT EXISTS "mcp_resource_templates_org_enabled_idx" ON "mcp_resource_templates" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "mcp_prompts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "server_id" uuid NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "title" text,
  "description" text,
  "arguments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "icons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_prompts_server_name_idx" ON "mcp_prompts" ("server_id", "name");
CREATE INDEX IF NOT EXISTS "mcp_prompts_org_enabled_idx" ON "mcp_prompts" ("organization_id", "enabled");

CREATE TABLE IF NOT EXISTS "mcp_content_reads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "server_id" uuid NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "identifier" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "payload_bytes" integer,
  "result_digest" text,
  "error_code" text,
  "duration_ms" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "mcp_content_reads_org_created_idx" ON "mcp_content_reads" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "mcp_content_reads_server_kind_idx" ON "mcp_content_reads" ("server_id", "kind");
