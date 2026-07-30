ALTER TABLE "mcp_servers"
  ADD COLUMN IF NOT EXISTS "auth_mode" text NOT NULL DEFAULT 'bearer',
  ADD COLUMN IF NOT EXISTS "encrypted_oauth_data" text,
  ADD COLUMN IF NOT EXISTS "oauth_scopes" text,
  ADD COLUMN IF NOT EXISTS "oauth_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "oauth_connected_at" timestamptz;

ALTER TABLE "mcp_tools"
  ADD COLUMN IF NOT EXISTS "capability" text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS "media_type" text;

CREATE INDEX IF NOT EXISTS "mcp_tools_org_capability_idx"
  ON "mcp_tools" ("organization_id", "capability", "enabled");
