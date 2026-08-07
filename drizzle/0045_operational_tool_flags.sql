INSERT INTO "platform_modules" ("organization_id", "key", "name", "description", "status", "position")
SELECT o."id", v."key", v."name", v."description", 'active', v."position"
FROM "organizations" o
CROSS JOIN (VALUES
  ('sandbox', 'بيئة التنفيذ', 'تشغيل معزول لمختبر البيانات ووكيل البرمجة', 40),
  ('browser', 'وكيل المتصفح', 'تشغيل المتصفح المعزول', 50),
  ('voice', 'استوديو الصوت', 'توليد الصوت عبر مزودات موثقة', 60)
) AS v("key", "name", "description", "position")
ON CONFLICT ("organization_id", "key") DO NOTHING;

INSERT INTO "feature_flags" ("organization_id", "key", "name", "description", "enabled", "rollout_percentage")
SELECT o."id", v."key", v."name", v."description", true, 100
FROM "organizations" o
CROSS JOIN (VALUES
  ('tool.data.interpreter', 'مختبر تحليل البيانات', 'تشغيل Python وتحليل الملفات داخل Execution Kernel'),
  ('tool.coding.agent', 'وكيل البرمجة', 'تنفيذ دورة Specify/Plan/Tasks/Implement/Verify داخل Workspace معزولة'),
  ('tool.browser.agent', 'وكيل المتصفح', 'تشغيل مهام Playwright الحقيقية عبر Browser Runtime'),
  ('tool.voice.studio', 'استوديو الصوت', 'توليد ملفات صوتية حقيقية عبر Provider Adapter')
) AS v("key", "name", "description")
ON CONFLICT ("organization_id", "key") DO NOTHING;
