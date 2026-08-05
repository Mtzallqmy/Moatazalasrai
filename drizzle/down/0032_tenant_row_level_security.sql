-- Reverses migration 0032 without touching application data or Graphile Worker tables.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles @> ARRAY['moataz_app_runtime']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', target.policyname, target.schemaname, target.tablename);
  END LOOP;

  FOR target IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', target.table_name);
  END LOOP;

  FOR target IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname LIKE 'rls_org_scope_%_idx'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', target.indexname);
  END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM moataz_app_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM moataz_app_runtime;
REVOKE USAGE ON SCHEMA public FROM moataz_app_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA graphile_worker FROM moataz_app_runtime;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA graphile_worker FROM moataz_app_runtime;
    REVOKE USAGE ON SCHEMA graphile_worker FROM moataz_app_runtime;
  END IF;
END
$$;

REVOKE moataz_app_runtime FROM CURRENT_USER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moataz_app_runtime') THEN
    DROP ROLE moataz_app_runtime;
  END IF;
END
$$;
