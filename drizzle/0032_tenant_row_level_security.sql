-- Enforces tenant and user isolation through a non-owner runtime role and forced RLS policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moataz_app_runtime') THEN
    CREATE ROLE moataz_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT moataz_app_runtime TO CURRENT_USER;
GRANT USAGE ON SCHEMA public, graphile_worker TO moataz_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO moataz_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO moataz_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO moataz_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA graphile_worker TO moataz_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO moataz_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO moataz_app_runtime;

DO $$
DECLARE
  target record;
  policy_name text;
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.table_name NOT IN ('organization_members', 'mobile_sessions', 'whatsapp_connections')
    ORDER BY c.table_name
  LOOP
    policy_name := target.table_name || '_tenant_scope';
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, target.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO moataz_app_runtime USING (current_setting(''app.rls_bypass'', true) = ''on'' OR organization_id::text = nullif(current_setting(''app.current_organization_id'', true), '''')) WITH CHECK (current_setting(''app.rls_bypass'', true) = ''on'' OR organization_id::text = nullif(current_setting(''app.current_organization_id'', true), ''''))',
      policy_name,
      target.table_name
    );
  END LOOP;
END
$$;

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_members_scope ON public.organization_members;
CREATE POLICY organization_members_scope ON public.organization_members
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
);

ALTER TABLE public.mobile_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mobile_sessions_scope ON public.mobile_sessions;
CREATE POLICY mobile_sessions_scope ON public.mobile_sessions
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR (
    organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
    AND user_id::text = nullif(current_setting('app.current_user_id', true), '')
  )
);

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_connections_scope ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_scope ON public.whatsapp_connections
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
);

ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_versions_tenant_scope ON public.agent_versions;
CREATE POLICY agent_versions_tenant_scope ON public.agent_versions
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.agents
    WHERE agents.id = agent_versions.agent_id
      AND agents.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.agents
    WHERE agents.id = agent_versions.agent_id
      AND agents.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_tenant_scope ON public.messages;
CREATE POLICY messages_tenant_scope ON public.messages
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.conversations
    WHERE conversations.id = messages.conversation_id
      AND conversations.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.conversations
    WHERE conversations.id = messages.conversation_id
      AND conversations.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
);

ALTER TABLE public.run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS run_events_tenant_scope ON public.run_events;
CREATE POLICY run_events_tenant_scope ON public.run_events
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = run_events.run_id
      AND runs.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = run_events.run_id
      AND runs.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
);

ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_updates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telegram_updates_tenant_scope ON public.telegram_updates;
CREATE POLICY telegram_updates_tenant_scope ON public.telegram_updates
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.integrations
    WHERE integrations.id = telegram_updates.integration_id
      AND integrations.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM public.integrations
    WHERE integrations.id = telegram_updates.integration_id
      AND integrations.organization_id::text = nullif(current_setting('app.current_organization_id', true), '')
  )
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_membership_scope ON public.organizations;
CREATE POLICY organizations_membership_scope ON public.organizations
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR id::text = nullif(current_setting('app.current_organization_id', true), '')
  OR EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = organizations.id
      AND organization_members.user_id::text = nullif(current_setting('app.current_user_id', true), '')
  )
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR id::text = nullif(current_setting('app.current_organization_id', true), '')
);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_user_scope ON public.sessions;
CREATE POLICY sessions_user_scope ON public.sessions
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_preferences_user_scope ON public.user_preferences;
CREATE POLICY user_preferences_user_scope ON public.user_preferences
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
);

ALTER TABLE public.whatsapp_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_link_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_link_tokens_user_scope ON public.whatsapp_link_tokens;
CREATE POLICY whatsapp_link_tokens_user_scope ON public.whatsapp_link_tokens
FOR ALL TO moataz_app_runtime
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
)
WITH CHECK (
  current_setting('app.rls_bypass', true) = 'on'
  OR user_id::text = nullif(current_setting('app.current_user_id', true), '')
);

DO $$
DECLARE
  target record;
  index_name text;
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
    ORDER BY c.table_name
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = target.table_name
        AND (i.indkey::smallint[])[0] = (
          SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = t.oid AND a.attname = 'organization_id'
        )
    ) THEN
      index_name := 'rls_org_scope_' || target.table_name || '_idx';
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)', index_name, target.table_name);
    END IF;
  END LOOP;
END
$$;
