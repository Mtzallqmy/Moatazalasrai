-- Operational tool discovery is fail-closed. The shared module is active so administrators
-- can manage it, while every individual tool remains disabled until explicitly enabled.
INSERT INTO "platform_modules" ("organization_id", "key", "name", "description", "status", "position")
SELECT o."id", 'operational_tools', 'Operational AI Tools', 'Phase 2 operational tool runtime', 'active', 70
FROM "organizations" o
ON CONFLICT ("organization_id", "key") DO NOTHING;

INSERT INTO "feature_flags" ("organization_id", "key", "name", "description", "enabled", "rollout_percentage")
SELECT o."id", f."key", f."name", f."description", false, 100
FROM "organizations" o
CROSS JOIN (VALUES
  ('data.interpreter', 'Data Interpreter', 'Isolated data analysis runtime'),
  ('coding.agent', 'Coding Agent', 'Isolated coding agent runtime'),
  ('browser.agent', 'Browser Agent', 'Isolated browser automation runtime'),
  ('voice.studio', 'Voice Studio', 'Provider-backed voice generation runtime')
) AS f("key", "name", "description")
ON CONFLICT ("organization_id", "key") DO NOTHING;
