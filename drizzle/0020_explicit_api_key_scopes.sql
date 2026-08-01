-- Preserve legacy administrator-key behavior explicitly before fail-closing empty scopes.
UPDATE "platform_api_keys"
SET "scopes" = '["agents:read","agents:write","chat:write","conversations:read","conversations:write","files:read","files:write","runs:read","runs:write","integrations:read","integrations:write","providers:read","providers:write","github:read","mcp:read","mcp:write","teams:read","teams:write"]'::jsonb
WHERE "scopes" = '[]'::jsonb;

ALTER TABLE "platform_api_keys"
  ADD CONSTRAINT "platform_api_keys_scopes_array_check"
  CHECK (jsonb_typeof("scopes") = 'array') NOT VALID;

ALTER TABLE "platform_api_keys"
  VALIDATE CONSTRAINT "platform_api_keys_scopes_array_check";
