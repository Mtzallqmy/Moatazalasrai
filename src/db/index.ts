import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/config/env";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | null = null;

function getClient() {
  if (!client) {
    client = postgres(env().databaseUrl, {
      max: 10,
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      prepare: false,
    });
  }
  return client;
}

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!database) database = drizzle(getClient(), { schema });
  return database;
}

const requiredTables = [
  "organizations",
  "users",
  "organization_members",
  "sessions",
  "provider_credentials",
  "agents",
  "agent_versions",
  "conversations",
  "messages",
  "runs",
  "run_events",
  "platform_api_keys",
  "audit_logs",
  "rate_limits",
  "integrations",
  "telegram_chats",
  "telegram_updates",
  "attachments",
  "agent_memories",
  "knowledge_bases",
  "knowledge_documents",
  "knowledge_chunks",
  "background_jobs",
  "tool_approvals",
  "mcp_tool_calls",
  "agent_run_steps",
  "agent_run_checkpoints",
  "agent_team_runs",
  "agent_team_run_steps",
  "worker_heartbeats",
  "site_connections",
  "agent_site_connections",
  "site_connection_permissions",
  "browser_tasks",
  "browser_task_steps",
  "site_oauth_states",
  "browser_login_sessions",
  "sandbox_workspaces",
  "conversation_sandbox_workspaces",
  "sandbox_permissions",
  "sandbox_executions",
  "sandbox_events",
  "sandbox_files",
  "sandbox_artifacts",
] as const;

export async function checkDatabase(): Promise<{
  ok: true;
  latencyMs: number;
  schemaTables: number;
  worker: { active: boolean; lastSeenAt: string | null };
}> {
  const startedAt = performance.now();
  const sql = getClient();
  const rows = await sql`
    SELECT
      to_regclass('public.organizations')::text AS organizations,
      to_regclass('public.users')::text AS users,
      to_regclass('public.organization_members')::text AS organization_members,
      to_regclass('public.sessions')::text AS sessions,
      to_regclass('public.provider_credentials')::text AS provider_credentials,
      to_regclass('public.agents')::text AS agents,
      to_regclass('public.agent_versions')::text AS agent_versions,
      to_regclass('public.conversations')::text AS conversations,
      to_regclass('public.messages')::text AS messages,
      to_regclass('public.runs')::text AS runs,
      to_regclass('public.run_events')::text AS run_events,
      to_regclass('public.platform_api_keys')::text AS platform_api_keys,
      to_regclass('public.audit_logs')::text AS audit_logs,
      to_regclass('public.rate_limits')::text AS rate_limits,
      to_regclass('public.integrations')::text AS integrations,
      to_regclass('public.telegram_chats')::text AS telegram_chats,
      to_regclass('public.telegram_updates')::text AS telegram_updates,
      to_regclass('public.attachments')::text AS attachments,
      to_regclass('public.agent_memories')::text AS agent_memories,
      to_regclass('public.knowledge_bases')::text AS knowledge_bases,
      to_regclass('public.knowledge_documents')::text AS knowledge_documents,
      to_regclass('public.knowledge_chunks')::text AS knowledge_chunks,
      to_regclass('public.background_jobs')::text AS background_jobs,
      to_regclass('public.tool_approvals')::text AS tool_approvals,
      to_regclass('public.mcp_tool_calls')::text AS mcp_tool_calls,
      to_regclass('public.agent_run_steps')::text AS agent_run_steps,
      to_regclass('public.agent_run_checkpoints')::text AS agent_run_checkpoints,
      to_regclass('public.agent_team_runs')::text AS agent_team_runs,
      to_regclass('public.agent_team_run_steps')::text AS agent_team_run_steps,
      to_regclass('public.worker_heartbeats')::text AS worker_heartbeats,
      to_regclass('public.site_connections')::text AS site_connections,
      to_regclass('public.agent_site_connections')::text AS agent_site_connections,
      to_regclass('public.site_connection_permissions')::text AS site_connection_permissions,
      to_regclass('public.browser_tasks')::text AS browser_tasks,
      to_regclass('public.browser_task_steps')::text AS browser_task_steps,
      to_regclass('public.site_oauth_states')::text AS site_oauth_states,
      to_regclass('public.browser_login_sessions')::text AS browser_login_sessions,
      to_regclass('public.sandbox_workspaces')::text AS sandbox_workspaces,
      to_regclass('public.conversation_sandbox_workspaces')::text AS conversation_sandbox_workspaces,
      to_regclass('public.sandbox_permissions')::text AS sandbox_permissions,
      to_regclass('public.sandbox_executions')::text AS sandbox_executions,
      to_regclass('public.sandbox_events')::text AS sandbox_events,
      to_regclass('public.sandbox_files')::text AS sandbox_files,
      to_regclass('public.sandbox_artifacts')::text AS sandbox_artifacts
  `;
  const state = rows[0] as Record<string, string | null> | undefined;
  const missingTables = requiredTables.filter((table) => !state?.[table]);
  if (missingTables.length > 0) {
    throw new Error(`Database schema is incomplete: ${missingTables.join(", ")}`);
  }

  const heartbeatRows = await sql<{ last_seen_at: Date | null }[]>`
    SELECT max(last_seen_at) AS last_seen_at
    FROM worker_heartbeats
    WHERE stopping_at IS NULL
  `;
  const lastSeenAt = heartbeatRows[0]?.last_seen_at ?? null;
  const active = Boolean(lastSeenAt && Date.now() - lastSeenAt.getTime() <= 90_000);

  return {
    ok: true,
    latencyMs: Math.round(performance.now() - startedAt),
    schemaTables: requiredTables.length,
    worker: { active, lastSeenAt: lastSeenAt?.toISOString() ?? null },
  };
}
