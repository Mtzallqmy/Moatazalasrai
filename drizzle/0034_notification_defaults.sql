INSERT INTO notification_templates (
  organization_id,
  key,
  name,
  channel,
  event_key,
  locale,
  subject,
  body,
  variables,
  enabled
)
SELECT
  id,
  'owner_user_registered_internal',
  'تسجيل مستخدم جديد للمالك',
  'internal',
  'user.registered',
  'ar',
  'مستخدم جديد',
  'تم تسجيل المستخدم {{name}} بالبريد {{email}}.',
  '["name","email"]'::jsonb,
  true
FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO notification_rules (
  organization_id,
  name,
  event_key,
  channel,
  template_id,
  audience_type,
  priority,
  enabled
)
SELECT
  template.organization_id,
  'إبلاغ المالك بتسجيل مستخدم',
  'user.registered',
  'internal',
  template.id,
  'owners',
  10,
  true
FROM notification_templates AS template
WHERE template.key = 'owner_user_registered_internal'
  AND NOT EXISTS (
    SELECT 1
    FROM notification_rules AS rule
    WHERE rule.organization_id = template.organization_id
      AND rule.event_key = 'user.registered'
      AND rule.channel = 'internal'
      AND rule.audience_type = 'owners'
  );

INSERT INTO notification_templates (
  organization_id,
  key,
  name,
  channel,
  event_key,
  locale,
  body,
  variables,
  whatsapp_template_name,
  whatsapp_template_status,
  enabled
)
SELECT
  id,
  'order_created_whatsapp_example',
  'مثال إشعار إنشاء طلب عبر WhatsApp',
  'whatsapp',
  'order.created',
  'ar',
  'مرحبًا {{name}}، تم إنشاء طلبك رقم {{order_id}} وحالته {{status}}.',
  '["name","order_id","status"]'::jsonb,
  NULL,
  'not_submitted',
  false
FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;
