-- Production hardening phase 2: database trust planes, tenant RLS, and composite tenant integrity.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moataz_app') THEN
    CREATE ROLE moataz_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moataz_platform') THEN
    CREATE ROLE moataz_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moataz_worker') THEN
    CREATE ROLE moataz_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT moataz_app, moataz_platform, moataz_worker TO %I', current_user);
END $$;

CREATE SCHEMA IF NOT EXISTS app_security;
REVOKE CREATE ON SCHEMA app_security FROM PUBLIC;
GRANT USAGE ON SCHEMA app_security TO moataz_app, moataz_platform, moataz_worker;

CREATE OR REPLACE FUNCTION app_security.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_security.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION app_security.current_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_security.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_security.current_organization_id() TO moataz_app, moataz_platform, moataz_worker;
GRANT EXECUTE ON FUNCTION app_security.current_user_id() TO moataz_app, moataz_platform, moataz_worker;

GRANT USAGE ON SCHEMA public TO moataz_app, moataz_platform, moataz_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO moataz_app, moataz_platform, moataz_worker;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO moataz_app, moataz_platform, moataz_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO moataz_app, moataz_platform, moataz_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO moataz_app, moataz_platform, moataz_worker;

REVOKE ALL ON TABLE platform_admins, platform_admin_audit_logs, platform_runtime_settings,
  platform_whatsapp_endpoints, platform_whatsapp_defaults, whatsapp_webhook_events,
  turnstile_verifications, _platform_migrations FROM moataz_app;
GRANT SELECT ON TABLE platform_runtime_settings, platform_whatsapp_endpoints, platform_whatsapp_defaults TO moataz_app;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_app_org_isolation ON public.%I', target.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_app_org_isolation ON public.%I TO moataz_app USING (organization_id = app_security.current_organization_id()) WITH CHECK (organization_id = app_security.current_organization_id())',
      target.table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS platform_ops_access ON public.%I', target.table_name);
    EXECUTE format('CREATE POLICY platform_ops_access ON public.%I TO moataz_platform USING (true) WITH CHECK (true)', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS worker_internal_access ON public.%I', target.table_name);
    EXECUTE format('CREATE POLICY worker_internal_access ON public.%I TO moataz_worker USING (true) WITH CHECK (true)', target.table_name);
  END LOOP;
END $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_organization_isolation ON organizations TO moataz_app USING (id = app_security.current_organization_id()) WITH CHECK (id = app_security.current_organization_id());
CREATE POLICY platform_organizations_access ON organizations TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_organizations_access ON organizations TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_users_isolation ON users TO moataz_app USING (
  id = app_security.current_user_id() OR EXISTS (
    SELECT 1 FROM organization_members membership
    WHERE membership.organization_id = app_security.current_organization_id() AND membership.user_id = users.id
  )
) WITH CHECK (id = app_security.current_user_id());
CREATE POLICY platform_users_access ON users TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_users_access ON users TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_preferences_isolation ON user_preferences TO moataz_app USING (user_id = app_security.current_user_id()) WITH CHECK (user_id = app_security.current_user_id());
CREATE POLICY platform_preferences_access ON user_preferences TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_preferences_access ON user_preferences TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_sessions_isolation ON sessions TO moataz_app USING (user_id = app_security.current_user_id()) WITH CHECK (user_id = app_security.current_user_id());
CREATE POLICY platform_sessions_access ON sessions TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_sessions_access ON sessions TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE user_mfa_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_mfa_isolation ON user_mfa_credentials TO moataz_app USING (user_id = app_security.current_user_id()) WITH CHECK (user_id = app_security.current_user_id());
CREATE POLICY platform_mfa_access ON user_mfa_credentials TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_mfa_access ON user_mfa_credentials TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE whatsapp_link_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_whatsapp_link_isolation ON whatsapp_link_tokens TO moataz_app USING (user_id = app_security.current_user_id()) WITH CHECK (user_id = app_security.current_user_id());
CREATE POLICY platform_whatsapp_link_access ON whatsapp_link_tokens TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_whatsapp_link_access ON whatsapp_link_tokens TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_agent_versions_isolation ON agent_versions TO moataz_app USING (EXISTS (SELECT 1 FROM agents parent WHERE parent.id = agent_versions.agent_id AND parent.organization_id = app_security.current_organization_id())) WITH CHECK (EXISTS (SELECT 1 FROM agents parent WHERE parent.id = agent_versions.agent_id AND parent.organization_id = app_security.current_organization_id()));
CREATE POLICY platform_agent_versions_access ON agent_versions TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_agent_versions_access ON agent_versions TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_messages_isolation ON messages TO moataz_app USING (EXISTS (SELECT 1 FROM conversations parent WHERE parent.id = messages.conversation_id AND parent.organization_id = app_security.current_organization_id())) WITH CHECK (EXISTS (SELECT 1 FROM conversations parent WHERE parent.id = messages.conversation_id AND parent.organization_id = app_security.current_organization_id()));
CREATE POLICY platform_messages_access ON messages TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_messages_access ON messages TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_run_events_isolation ON run_events TO moataz_app USING (EXISTS (SELECT 1 FROM runs parent WHERE parent.id = run_events.run_id AND parent.organization_id = app_security.current_organization_id())) WITH CHECK (EXISTS (SELECT 1 FROM runs parent WHERE parent.id = run_events.run_id AND parent.organization_id = app_security.current_organization_id()));
CREATE POLICY platform_run_events_access ON run_events TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_run_events_access ON run_events TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE telegram_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_telegram_updates_isolation ON telegram_updates TO moataz_app USING (EXISTS (SELECT 1 FROM integrations parent WHERE parent.id = telegram_updates.integration_id AND parent.organization_id = app_security.current_organization_id())) WITH CHECK (EXISTS (SELECT 1 FROM integrations parent WHERE parent.id = telegram_updates.integration_id AND parent.organization_id = app_security.current_organization_id()));
CREATE POLICY platform_telegram_updates_access ON telegram_updates TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_telegram_updates_access ON telegram_updates TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE execution_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_execution_steps_isolation ON execution_steps TO moataz_app USING (EXISTS (SELECT 1 FROM execution_jobs parent WHERE parent.id = execution_steps.job_id AND parent.organization_id = app_security.current_organization_id())) WITH CHECK (EXISTS (SELECT 1 FROM execution_jobs parent WHERE parent.id = execution_steps.job_id AND parent.organization_id = app_security.current_organization_id()));
CREATE POLICY platform_execution_steps_access ON execution_steps TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_execution_steps_access ON execution_steps TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE execution_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_execution_events_isolation ON execution_events TO moataz_app USING (EXISTS (SELECT 1 FROM execution_jobs parent WHERE parent.id = execution_events.job_id AND parent.organization_id = app_security.current_organization_id())) WITH CHECK (EXISTS (SELECT 1 FROM execution_jobs parent WHERE parent.id = execution_events.job_id AND parent.organization_id = app_security.current_organization_id()));
CREATE POLICY platform_execution_events_access ON execution_events TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_execution_events_access ON execution_events TO moataz_worker USING (true) WITH CHECK (true);

ALTER TABLE execution_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_app_execution_leases_isolation ON execution_leases TO moataz_app USING (EXISTS (SELECT 1 FROM execution_jobs parent WHERE parent.id = execution_leases.job_id AND parent.organization_id = app_security.current_organization_id())) WITH CHECK (EXISTS (SELECT 1 FROM execution_jobs parent WHERE parent.id = execution_leases.job_id AND parent.organization_id = app_security.current_organization_id()));
CREATE POLICY platform_execution_leases_access ON execution_leases TO moataz_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_execution_leases_access ON execution_leases TO moataz_worker USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_org_id_unique_idx ON provider_credentials (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS agents_org_id_unique_idx ON agents (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_folders_org_id_unique_idx ON conversation_folders (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_org_id_unique_idx ON conversations (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS attachments_org_id_unique_idx ON attachments (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_bases_org_id_unique_idx ON knowledge_bases (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_org_id_unique_idx ON knowledge_documents (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS coding_projects_org_id_unique_idx ON coding_projects (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS execution_artifacts_org_id_unique_idx ON execution_artifacts (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_agent_id_id_unique_idx ON agent_versions (agent_id, id);

ALTER TABLE conversations ADD CONSTRAINT conversations_org_agent_fk FOREIGN KEY (organization_id, agent_id) REFERENCES agents (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE conversation_members ADD CONSTRAINT conversation_members_org_conversation_fk FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE conversation_drafts ADD CONSTRAINT conversation_drafts_org_conversation_fk FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE runs ADD CONSTRAINT runs_org_agent_fk FOREIGN KEY (organization_id, agent_id) REFERENCES agents (organization_id, id) NOT VALID;
ALTER TABLE runs ADD CONSTRAINT runs_agent_version_fk FOREIGN KEY (agent_id, agent_version_id) REFERENCES agent_versions (agent_id, id) NOT VALID;
ALTER TABLE attachments ADD CONSTRAINT attachments_org_conversation_fk FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_org_kb_fk FOREIGN KEY (organization_id, knowledge_base_id) REFERENCES knowledge_bases (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_org_attachment_fk FOREIGN KEY (organization_id, attachment_id) REFERENCES attachments (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE knowledge_chunks ADD CONSTRAINT knowledge_chunks_org_document_fk FOREIGN KEY (organization_id, document_id) REFERENCES knowledge_documents (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE execution_jobs ADD CONSTRAINT execution_jobs_org_workspace_fk FOREIGN KEY (organization_id, workspace_id) REFERENCES execution_workspaces (organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE execution_artifacts ADD CONSTRAINT execution_artifacts_org_job_fk FOREIGN KEY (organization_id, job_id) REFERENCES execution_jobs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE execution_credential_grants ADD CONSTRAINT execution_credential_grants_org_job_fk FOREIGN KEY (organization_id, job_id) REFERENCES execution_jobs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE execution_credential_grants ADD CONSTRAINT execution_credential_grants_org_credential_fk FOREIGN KEY (organization_id, credential_id) REFERENCES provider_credentials (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE execution_usage ADD CONSTRAINT execution_usage_org_job_fk FOREIGN KEY (organization_id, job_id) REFERENCES execution_jobs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tool_runs ADD CONSTRAINT tool_runs_org_execution_job_fk FOREIGN KEY (organization_id, execution_job_id) REFERENCES execution_jobs (organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE tool_run_messages ADD CONSTRAINT tool_run_messages_org_run_fk FOREIGN KEY (organization_id, tool_run_id) REFERENCES tool_runs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tool_run_inputs ADD CONSTRAINT tool_run_inputs_org_run_fk FOREIGN KEY (organization_id, tool_run_id) REFERENCES tool_runs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tool_run_inputs ADD CONSTRAINT tool_run_inputs_org_artifact_fk FOREIGN KEY (organization_id, artifact_id) REFERENCES execution_artifacts (organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE tool_run_approvals ADD CONSTRAINT tool_run_approvals_org_run_fk FOREIGN KEY (organization_id, tool_run_id) REFERENCES tool_runs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE data_interpreter_sessions ADD CONSTRAINT data_interpreter_sessions_org_run_fk FOREIGN KEY (organization_id, tool_run_id) REFERENCES tool_runs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE data_interpreter_sessions ADD CONSTRAINT data_interpreter_sessions_org_workspace_fk FOREIGN KEY (organization_id, workspace_id) REFERENCES execution_workspaces (organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE coding_agent_runs ADD CONSTRAINT coding_agent_runs_org_run_fk FOREIGN KEY (organization_id, tool_run_id) REFERENCES tool_runs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE coding_agent_runs ADD CONSTRAINT coding_agent_runs_org_project_fk FOREIGN KEY (organization_id, project_id) REFERENCES coding_projects (organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE browser_agent_sessions ADD CONSTRAINT browser_agent_sessions_org_run_fk FOREIGN KEY (organization_id, tool_run_id) REFERENCES tool_runs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE browser_agent_sessions ADD CONSTRAINT browser_agent_sessions_org_workspace_fk FOREIGN KEY (organization_id, workspace_id) REFERENCES execution_workspaces (organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE voice_generation_jobs ADD CONSTRAINT voice_generation_jobs_org_run_fk FOREIGN KEY (organization_id, tool_run_id) REFERENCES tool_runs (organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE voice_generation_jobs ADD CONSTRAINT voice_generation_jobs_org_provider_fk FOREIGN KEY (organization_id, provider_credential_id) REFERENCES provider_credentials (organization_id, id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE conversations VALIDATE CONSTRAINT conversations_org_agent_fk;
ALTER TABLE conversation_members VALIDATE CONSTRAINT conversation_members_org_conversation_fk;
ALTER TABLE conversation_drafts VALIDATE CONSTRAINT conversation_drafts_org_conversation_fk;
ALTER TABLE runs VALIDATE CONSTRAINT runs_org_agent_fk;
ALTER TABLE runs VALIDATE CONSTRAINT runs_agent_version_fk;
ALTER TABLE attachments VALIDATE CONSTRAINT attachments_org_conversation_fk;
ALTER TABLE knowledge_documents VALIDATE CONSTRAINT knowledge_documents_org_kb_fk;
ALTER TABLE knowledge_documents VALIDATE CONSTRAINT knowledge_documents_org_attachment_fk;
ALTER TABLE knowledge_chunks VALIDATE CONSTRAINT knowledge_chunks_org_document_fk;
ALTER TABLE execution_jobs VALIDATE CONSTRAINT execution_jobs_org_workspace_fk;
ALTER TABLE execution_artifacts VALIDATE CONSTRAINT execution_artifacts_org_job_fk;
ALTER TABLE execution_credential_grants VALIDATE CONSTRAINT execution_credential_grants_org_job_fk;
ALTER TABLE execution_credential_grants VALIDATE CONSTRAINT execution_credential_grants_org_credential_fk;
ALTER TABLE execution_usage VALIDATE CONSTRAINT execution_usage_org_job_fk;
ALTER TABLE tool_runs VALIDATE CONSTRAINT tool_runs_org_execution_job_fk;
ALTER TABLE tool_run_messages VALIDATE CONSTRAINT tool_run_messages_org_run_fk;
ALTER TABLE tool_run_inputs VALIDATE CONSTRAINT tool_run_inputs_org_run_fk;
ALTER TABLE tool_run_inputs VALIDATE CONSTRAINT tool_run_inputs_org_artifact_fk;
ALTER TABLE tool_run_approvals VALIDATE CONSTRAINT tool_run_approvals_org_run_fk;
ALTER TABLE data_interpreter_sessions VALIDATE CONSTRAINT data_interpreter_sessions_org_run_fk;
ALTER TABLE data_interpreter_sessions VALIDATE CONSTRAINT data_interpreter_sessions_org_workspace_fk;
ALTER TABLE coding_agent_runs VALIDATE CONSTRAINT coding_agent_runs_org_run_fk;
ALTER TABLE coding_agent_runs VALIDATE CONSTRAINT coding_agent_runs_org_project_fk;
ALTER TABLE browser_agent_sessions VALIDATE CONSTRAINT browser_agent_sessions_org_run_fk;
ALTER TABLE browser_agent_sessions VALIDATE CONSTRAINT browser_agent_sessions_org_workspace_fk;
ALTER TABLE voice_generation_jobs VALIDATE CONSTRAINT voice_generation_jobs_org_run_fk;
ALTER TABLE voice_generation_jobs VALIDATE CONSTRAINT voice_generation_jobs_org_provider_fk;

CREATE OR REPLACE FUNCTION app_security.enforce_tenant_reference_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_org uuid;
BEGIN
  IF TG_TABLE_NAME = 'conversations' THEN
    IF NEW.provider_credential_id IS NOT NULL THEN
      SELECT organization_id INTO parent_org FROM provider_credentials WHERE id = NEW.provider_credential_id;
      IF parent_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'CROSS_TENANT_PROVIDER_REFERENCE' USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.folder_id IS NOT NULL THEN
      SELECT organization_id INTO parent_org FROM conversation_folders WHERE id = NEW.folder_id;
      IF parent_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'CROSS_TENANT_FOLDER_REFERENCE' USING ERRCODE = '23503'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_versions' THEN
    SELECT organization_id INTO parent_org FROM agents WHERE id = NEW.agent_id;
    IF NOT EXISTS (SELECT 1 FROM provider_credentials WHERE id = NEW.provider_credential_id AND organization_id = parent_org) THEN
      RAISE EXCEPTION 'CROSS_TENANT_AGENT_PROVIDER_REFERENCE' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    SELECT organization_id INTO parent_org FROM conversations WHERE id = NEW.conversation_id;
    IF NEW.provider_credential_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM provider_credentials WHERE id = NEW.provider_credential_id AND organization_id = parent_org) THEN
      RAISE EXCEPTION 'CROSS_TENANT_MESSAGE_PROVIDER_REFERENCE' USING ERRCODE = '23503';
    END IF;
    IF NEW.parent_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM messages WHERE id = NEW.parent_message_id AND conversation_id = NEW.conversation_id) THEN
      RAISE EXCEPTION 'CROSS_CONVERSATION_PARENT_MESSAGE_REFERENCE' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app_security.enforce_tenant_reference_integrity() FROM PUBLIC;

CREATE TRIGGER conversations_tenant_reference_guard BEFORE INSERT OR UPDATE OF organization_id, provider_credential_id, folder_id ON conversations FOR EACH ROW EXECUTE FUNCTION app_security.enforce_tenant_reference_integrity();
CREATE TRIGGER agent_versions_tenant_reference_guard BEFORE INSERT OR UPDATE OF agent_id, provider_credential_id ON agent_versions FOR EACH ROW EXECUTE FUNCTION app_security.enforce_tenant_reference_integrity();
CREATE TRIGGER messages_tenant_reference_guard BEFORE INSERT OR UPDATE OF conversation_id, provider_credential_id, parent_message_id ON messages FOR EACH ROW EXECUTE FUNCTION app_security.enforce_tenant_reference_integrity();
