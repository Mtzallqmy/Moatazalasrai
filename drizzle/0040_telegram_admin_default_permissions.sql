-- Seed safe defaults for central Telegram links created before automatic permission provisioning.
-- Existing permission rows are preserved, so an explicit administrative denial is never overwritten.
INSERT INTO "telegram_feature_permissions" (
  "user_id",
  "organization_id",
  "feature_key",
  "enabled",
  "limits",
  "updated_by"
)
SELECT
  links."user_id",
  links."organization_id",
  features."feature_key",
  true,
  '{}'::jsonb,
  links."user_id"
FROM "telegram_account_links" AS links
JOIN "organization_members" AS members
  ON members."organization_id" = links."organization_id"
 AND members."user_id" = links."user_id"
CROSS JOIN (
  VALUES
    ('telegram.chat'),
    ('telegram.agents'),
    ('telegram.files'),
    ('telegram.images'),
    ('telegram.audio'),
    ('telegram.video'),
    ('telegram.admin_commands')
) AS features("feature_key")
WHERE links."status" = 'active'
  AND members."role" IN ('owner', 'admin')
ON CONFLICT ("user_id", "feature_key") DO NOTHING;
