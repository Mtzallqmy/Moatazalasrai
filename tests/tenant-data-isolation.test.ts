import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { TENANT_DATA_CLASSIFICATION } from "@/db/tenant-classification";

const root = process.cwd();

describe("tenant data isolation architecture", () => {
  test("classifies direct, derived, shared, platform, and system data", () => {
    expect(TENANT_DATA_CLASSIFICATION.directTenantRule).toContain("organization_id");
    expect(TENANT_DATA_CLASSIFICATION.derivedTenant).toContain("messages");
    expect(TENANT_DATA_CLASSIFICATION.sharedIdentity).toContain("sessions");
    expect(TENANT_DATA_CLASSIFICATION.platformOwned).toContain("platform_admins");
    expect(TENANT_DATA_CLASSIFICATION.systemInternal).toContain("_platform_migrations");
  });

  test("runtime database roles cannot login, bypass RLS, or inherit privileges", async () => {
    const migration = await readFile(`${root}/drizzle/0048_tenant_data_isolation.sql`, "utf8");
    for (const role of ["moataz_app", "moataz_platform", "moataz_worker"]) {
      expect(migration).toContain(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    }
    expect(migration).toContain("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("organization_id = app_security.current_organization_id()");
  });

  test("derived tenant rows are protected by their owning parent", async () => {
    const migration = await readFile(`${root}/drizzle/0048_tenant_data_isolation.sql`, "utf8");
    expect(migration).toContain("tenant_app_agent_versions_isolation");
    expect(migration).toContain("tenant_app_messages_isolation");
    expect(migration).toContain("tenant_app_run_events_isolation");
    expect(migration).toContain("tenant_app_telegram_updates_isolation");
    expect(migration).toContain("tenant_app_execution_steps_isolation");
    expect(migration).toContain("tenant_app_execution_events_isolation");
    expect(migration).toContain("tenant_app_execution_leases_isolation");
  });

  test("critical tenant relations use composite integrity constraints", async () => {
    const migration = await readFile(`${root}/drizzle/0048_tenant_data_isolation.sql`, "utf8");
    for (const constraint of [
      "conversations_org_agent_fk",
      "conversation_members_org_conversation_fk",
      "runs_org_agent_fk",
      "knowledge_documents_org_kb_fk",
      "knowledge_chunks_org_document_fk",
      "execution_jobs_org_workspace_fk",
      "execution_artifacts_org_job_fk",
      "execution_credential_grants_org_credential_fk",
      "tool_runs_org_execution_job_fk",
      "tool_run_messages_org_run_fk",
      "data_interpreter_sessions_org_workspace_fk",
      "coding_agent_runs_org_project_fk",
      "browser_agent_sessions_org_workspace_fk",
      "voice_generation_jobs_org_provider_fk",
    ]) expect(migration).toContain(constraint);
    expect(migration).toContain("CROSS_TENANT_AGENT_PROVIDER_REFERENCE");
    expect(migration).toContain("CROSS_TENANT_MESSAGE_PROVIDER_REFERENCE");
  });

  test("request identity is resolved on system plane before entering tenant or platform role", async () => {
    const session = await readFile(`${root}/src/lib/auth/session.ts`, "utf8");
    const apiKey = await readFile(`${root}/src/lib/auth/api-key.ts`, "utf8");
    const platform = await readFile(`${root}/src/lib/auth/platform-authorization.ts`, "utf8");
    expect(session).toContain("runWithSystemDatabaseContext(resolveCurrentSession)");
    expect(session).toContain("enterTenantDatabaseContext(session.organizationId, session.userId)");
    expect(apiKey).toContain("runWithSystemDatabaseContext(() => resolveApiPrincipal(request))");
    expect(apiKey).toContain("enterTenantDatabaseContext(principal.organizationId, principal.userId)");
    expect(platform).toContain("runWithSystemDatabaseContext");
    expect(platform).toContain("enterPlatformDatabaseContext(session.userId)");
  });

  test("Drizzle cannot pin the first privileged pool for all later requests", async () => {
    const database = await readFile(`${root}/src/db/index.ts`, "utf8");
    expect(database).toContain("const databasesByPool = new WeakMap");
    expect(database).toContain("const pool = getPostgresPool()");
    expect(database).not.toContain("let database:");
  });

  test("Graphile Worker keeps schema ownership separate from runtime data roles", async () => {
    const worker = await readFile(`${root}/src/worker/index.ts`, "utf8");
    const queue = await readFile(`${root}/src/worker/queue.ts`, "utf8");
    const migration = await readFile(`${root}/scripts/migrate-worker.mjs`, "utf8");
    expect(worker).toContain('configureDatabaseProcessKind("worker")');
    expect(worker).toContain("pgPool: getSystemPostgresPool()");
    expect(queue).toContain("app_security.enqueue_job");
    expect(queue).not.toContain("makeWorkerUtils");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION");
  });
});
