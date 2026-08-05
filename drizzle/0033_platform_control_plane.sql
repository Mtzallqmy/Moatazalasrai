CREATE TABLE IF NOT EXISTS platform_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','hidden','deleted')),
  position integer NOT NULL DEFAULT 100,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_modules_org_key_unique UNIQUE (organization_id, key)
);
CREATE INDEX IF NOT EXISTS platform_modules_org_status_position_idx ON platform_modules (organization_id, status, position);

CREATE TABLE IF NOT EXISTS feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percentage integer NOT NULL DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_org_key_unique UNIQUE (organization_id, key)
);
CREATE INDEX IF NOT EXISTS feature_flags_org_enabled_idx ON feature_flags (organization_id, enabled);

CREATE TABLE IF NOT EXISTS custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  system boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_roles_org_key_unique UNIQUE (organization_id, key)
);
CREATE INDEX IF NOT EXISTS custom_roles_org_enabled_idx ON custom_roles (organization_id, enabled, deleted_at);

CREATE TABLE IF NOT EXISTS custom_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_role_permissions_role_permission_unique UNIQUE (role_id, permission)
);
CREATE INDEX IF NOT EXISTS custom_role_permissions_org_role_idx ON custom_role_permissions (organization_id, role_id);

CREATE TABLE IF NOT EXISTS member_custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  organization_member_id uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_custom_roles_member_role_unique UNIQUE (organization_member_id, role_id)
);
CREATE INDEX IF NOT EXISTS member_custom_roles_org_member_idx ON member_custom_roles (organization_id, organization_member_id);

CREATE TABLE IF NOT EXISTS platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  namespace text NOT NULL DEFAULT 'general',
  key text NOT NULL,
  value jsonb NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_org_namespace_key_unique UNIQUE (organization_id, namespace, key)
);
CREATE INDEX IF NOT EXISTS platform_settings_org_namespace_idx ON platform_settings (organization_id, namespace);

CREATE TABLE IF NOT EXISTS deleted_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  label text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  restorable_until timestamptz,
  restored_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  restored_at timestamptz,
  permanently_deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  permanently_deleted_at timestamptz,
  CONSTRAINT deleted_items_org_resource_unique UNIQUE (organization_id, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS deleted_items_org_active_idx ON deleted_items (organization_id, restored_at, permanently_deleted_at, deleted_at);

CREATE TABLE IF NOT EXISTS domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id text,
  resource_type text,
  resource_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_events_org_idempotency_unique_idx ON domain_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_events_org_key_created_idx ON domain_events (organization_id, event_key, created_at);
CREATE INDEX IF NOT EXISTS domain_events_pending_idx ON domain_events (processed_at, created_at);

CREATE TABLE IF NOT EXISTS notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','push','internal')),
  event_key text NOT NULL,
  locale text NOT NULL DEFAULT 'ar',
  subject text,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  whatsapp_template_name text,
  whatsapp_template_status text NOT NULL DEFAULT 'not_submitted',
  enabled boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_templates_org_key_unique UNIQUE (organization_id, key)
);
CREATE INDEX IF NOT EXISTS notification_templates_org_event_channel_idx ON notification_templates (organization_id, event_key, channel, enabled);

CREATE TABLE IF NOT EXISTS notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  event_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','push','internal')),
  template_id uuid NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
  audience_type text NOT NULL DEFAULT 'event_user',
  audience_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_rules_org_event_enabled_idx ON notification_rules (organization_id, event_key, enabled, priority);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES notification_rules(id) ON DELETE SET NULL,
  template_id uuid REFERENCES notification_templates(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','push','internal')),
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','delivered','read','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  provider_message_id text,
  last_error_code text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_event_rule_recipient_unique UNIQUE (event_id, rule_id, recipient)
);
CREATE INDEX IF NOT EXISTS notification_deliveries_org_status_scheduled_idx ON notification_deliveries (organization_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS internal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES notification_deliveries(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS internal_notifications_user_read_created_idx ON internal_notifications (user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS internal_notifications_org_created_idx ON internal_notifications (organization_id, created_at);

INSERT INTO platform_modules (organization_id, key, name, description, status, position)
SELECT id, seed.key, seed.name, seed.description, seed.status, seed.position
FROM organizations
CROSS JOIN (VALUES
  ('users', 'المستخدمون والصلاحيات', 'إدارة أعضاء المؤسسة والأدوار.', 'active', 10),
  ('agents', 'الوكلاء الذكيون', 'إدارة الوكلاء والفرق والأدوات.', 'active', 20),
  ('providers', 'المزودات والنماذج', 'BYOK والتوجيه ومراقبة الصحة.', 'active', 30),
  ('channels', 'القنوات والمحادثات', 'Telegram وWhatsApp وصناديق المحادثات.', 'active', 40),
  ('notifications', 'مركز الإشعارات', 'قواعد الأحداث والقوالب والتسليم.', 'active', 50),
  ('content', 'المحتوى والمعرفة', 'الملفات وقواعد المعرفة والمستودعات.', 'active', 60),
  ('audit', 'التدقيق والتشخيص', 'سجل العمليات وصحة المنصة.', 'active', 70),
  ('settings', 'إعدادات المنصة', 'إعدادات قابلة للإدارة دون تعديل الكود.', 'active', 80)
) AS seed(key, name, description, status, position)
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO feature_flags (organization_id, key, name, description, enabled, rollout_percentage)
SELECT id, seed.key, seed.name, seed.description, seed.enabled, 100
FROM organizations
CROSS JOIN (VALUES
  ('whatsapp_integration', 'تكامل WhatsApp', 'تفعيل قناة WhatsApp Business.', true),
  ('live_chat', 'المحادثات المباشرة', 'إتاحة المحادثات المباشرة.', true),
  ('ai_assistant', 'مساعد الذكاء الاصطناعي', 'إتاحة تشغيل الوكلاء.', true),
  ('central_notifications', 'مركز الإشعارات', 'تشغيل Event Outbox والتسليم الخلفي.', true),
  ('payments', 'المدفوعات', 'محجوز لتكامل مستقبلي.', false),
  ('reviews', 'المراجعات', 'محجوز لوحدة مستقبلية.', false)
) AS seed(key, name, description, enabled)
ON CONFLICT (organization_id, key) DO NOTHING;
