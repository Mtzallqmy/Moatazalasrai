CREATE TABLE IF NOT EXISTS site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  excerpt text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','published','disabled','hidden','deleted')),
  template text NOT NULL DEFAULT 'standard',
  position integer NOT NULL DEFAULT 100,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz,
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_pages_org_slug_unique UNIQUE (organization_id, slug)
);
CREATE INDEX IF NOT EXISTS site_pages_org_status_position_idx ON site_pages (organization_id, status, position);
CREATE INDEX IF NOT EXISTS site_pages_org_updated_idx ON site_pages (organization_id, updated_at);

CREATE TABLE IF NOT EXISTS site_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
  key text NOT NULL,
  type text NOT NULL DEFAULT 'rich_text' CHECK (type IN ('hero','rich_text','features','services','callout','image','faq','cta','custom')),
  title text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','published','disabled','hidden','deleted')),
  position integer NOT NULL DEFAULT 100,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_page_sections_page_key_unique UNIQUE (page_id, key)
);
CREATE INDEX IF NOT EXISTS site_page_sections_page_status_position_idx ON site_page_sections (page_id, status, position);
CREATE INDEX IF NOT EXISTS site_page_sections_org_updated_idx ON site_page_sections (organization_id, updated_at);

CREATE TABLE IF NOT EXISTS site_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  summary text,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','published','disabled','hidden','deleted')),
  position integer NOT NULL DEFAULT 100,
  icon text,
  image_url text,
  action_label text,
  action_url text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_services_org_slug_unique UNIQUE (organization_id, slug)
);
CREATE INDEX IF NOT EXISTS site_services_org_status_position_idx ON site_services (organization_id, status, position);

CREATE TABLE IF NOT EXISTS site_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','published','disabled','hidden','deleted')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_menus_org_key_unique UNIQUE (organization_id, key)
);
CREATE INDEX IF NOT EXISTS site_menus_org_status_idx ON site_menus (organization_id, status);

CREATE TABLE IF NOT EXISTS site_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  menu_id uuid NOT NULL REFERENCES site_menus(id) ON DELETE CASCADE,
  key text NOT NULL,
  parent_key text,
  label text NOT NULL,
  href text,
  page_id uuid REFERENCES site_pages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','published','disabled','hidden','deleted')),
  position integer NOT NULL DEFAULT 100,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_menu_items_menu_key_unique UNIQUE (menu_id, key),
  CONSTRAINT site_menu_items_target_check CHECK (href IS NOT NULL OR page_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_menu_items_menu_status_position_idx ON site_menu_items (menu_id, status, position);

CREATE TABLE IF NOT EXISTS content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_summary text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_revisions_resource_version_unique UNIQUE (organization_id, resource_type, resource_id, version)
);
CREATE INDEX IF NOT EXISTS content_revisions_resource_created_idx ON content_revisions (organization_id, resource_type, resource_id, created_at);

CREATE TABLE IF NOT EXISTS user_mfa_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  secret_hint text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  last_used_step integer,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_mfa_credentials_enabled_idx ON user_mfa_credentials (enabled);
CREATE INDEX IF NOT EXISTS user_mfa_credentials_locked_idx ON user_mfa_credentials (locked_until);

ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO platform_modules (organization_id, key, name, description, status, position)
SELECT id, seed.key, seed.name, seed.description, 'active', seed.position
FROM organizations
CROSS JOIN (VALUES
  ('content_management', 'إدارة المحتوى والصفحات', 'صفحات الموقع والأقسام والقوائم والمراجعات.', 55),
  ('service_catalog', 'دليل الخدمات', 'إدارة الخدمات وظهورها وترتيبها وإجراءاتها.', 56),
  ('security_center', 'مركز الأمان', 'إدارة MFA والجلسات والأحداث الأمنية.', 75)
) AS seed(key, name, description, position)
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO feature_flags (organization_id, key, name, description, enabled, rollout_percentage)
SELECT id, seed.key, seed.name, seed.description, seed.enabled, 100
FROM organizations
CROSS JOIN (VALUES
  ('content_management', 'نظام إدارة المحتوى', 'إدارة ونشر صفحات وخدمات الموقع.', true),
  ('mfa', 'المصادقة متعددة العوامل', 'تفعيل إعداد واستخدام TOTP ورموز الاسترداد.', true),
  ('public_dynamic_pages', 'الصفحات العامة الديناميكية', 'عرض الصفحات المنشورة من قاعدة البيانات.', true)
) AS seed(key, name, description, enabled)
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO custom_roles (organization_id, key, name, description, enabled, system)
SELECT organization_id, seed.key, seed.name, seed.description, true, true
FROM (SELECT id AS organization_id FROM organizations) organizations
CROSS JOIN (VALUES
  ('manager', 'Manager', 'إدارة العمليات والمحتوى والإشعارات دون صلاحيات المالك الحساسة.'),
  ('editor', 'Editor', 'إنشاء وتعديل ونشر محتوى الموقع والخدمات.'),
  ('support', 'Support', 'إدارة محادثات الدعم والتحويل البشري ومتابعة الإشعارات.')
) AS seed(key, name, description)
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO custom_role_permissions (organization_id, role_id, permission, allowed)
SELECT role.organization_id, role.id, permission.value, true
FROM custom_roles AS role
CROSS JOIN LATERAL (
  SELECT value FROM jsonb_array_elements_text(
    CASE role.key
      WHEN 'manager' THEN '["platform:read","analytics:read","members:read","audit:read","content:read","content:manage","content:publish","services:read","services:manage","menus:read","menus:manage","notifications:read","notifications:manage","notifications:send","channels:read","channels:manage","channels:use","channels:handoff","files:read","files:upload","files:manage"]'::jsonb
      WHEN 'editor' THEN '["platform:read","content:read","content:manage","content:publish","services:read","services:manage","menus:read","menus:manage","notifications:read","files:read","files:upload","files:manage"]'::jsonb
      WHEN 'support' THEN '["platform:read","members:read","channels:read","channels:use","channels:handoff","notifications:read","runs:read","agents:read","files:read"]'::jsonb
      ELSE '[]'::jsonb
    END
  )
) AS permission
WHERE role.key IN ('manager','editor','support')
ON CONFLICT (role_id, permission) DO NOTHING;

INSERT INTO site_menus (organization_id, key, name, status)
SELECT id, 'primary', 'القائمة الرئيسية', 'active'
FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;
