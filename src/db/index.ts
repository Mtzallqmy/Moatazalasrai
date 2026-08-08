import { drizzle } from "drizzle-orm/node-postgres";
import { getPostgresPool } from "@/db/pool";
import * as coreSchema from "./schema";
import * as channelSchema from "./channel-schema";
import * as controlPlaneSchema from "./control-plane-schema";
import * as adminSchema from "./admin-schema";
import * as executionSchema from "./execution-schema";
import * as fileIntelligenceSchema from "./file-intelligence-schema";
import * as toolRunSchema from "./tool-run-schema";

const schema = { ...coreSchema, ...channelSchema, ...controlPlaneSchema, ...adminSchema, ...executionSchema, ...fileIntelligenceSchema, ...toolRunSchema };
type DatabaseSchema = typeof schema;
let database: ReturnType<typeof drizzle<DatabaseSchema>> | null = null;

export function db() {
  database ??= drizzle(getPostgresPool(), { schema });
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
  "conversation_members",
  "conversation_drafts",
  "messages",
  "runs",
  "run_events",
  "platform_api_keys",
  "audit_logs",
  "rate_limits",
  "integrations",
  "telegram_chats",
  "telegram_updates",
  "whatsapp_connections",
  "whatsapp_link_tokens",
  "whatsapp_webhook_events",
  "attachments",
  "attachment_intelligence",
  "attachment_chunks",
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
  "platform_runtime_settings",
  "channel_inboxes",
  "channel_inbox_members",
  "channel_workflows",
  "channel_connections",
  "channel_agent_bindings",
  "channel_provider_bindings",
  "channel_tool_bindings",
  "channel_permissions",
  "channel_routing_rules",
  "channel_contacts",
  "channel_conversation_links",
  "channel_events",
  "channel_handoffs",
  "platform_modules",
  "feature_flags",
  "custom_roles",
  "custom_role_permissions",
  "member_custom_roles",
  "platform_settings",
  "deleted_items",
  "domain_events",
  "notification_templates",
  "notification_rules",
  "notification_deliveries",
  "internal_notifications",
  "site_pages",
  "site_page_sections",
  "site_services",
  "site_menus",
  "site_menu_items",
  "content_revisions",
  "user_mfa_credentials",
  "execution_workspaces",
  "execution_jobs",
  "execution_steps",
  "execution_events",
  "execution_artifacts",
  "execution_leases",
  "execution_credential_grants",
  "execution_usage",
  "tool_runs",
  "tool_run_messages",
  "tool_run_inputs",
  "tool_run_approvals",
  "data_interpreter_sessions",
  "coding_projects",
  "coding_agent_runs",
  "browser_agent_sessions",
  "voice_generation_jobs",
] as const;

export async function checkDatabase(): Promise<{
  ok: true;
  latencyMs: number;
  schemaTables: number;
  worker: { active: boolean; lastSeenAt: string | null };
}> {
  const startedAt = performance.now();
  const pool = getPostgresPool();
  const tableResult = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [requiredTables]);
  const present = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !present.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Database schema is incomplete: ${missingTables.join(", ")}`);
  }

  const heartbeatResult = await pool.query<{ last_seen_at: Date | null }>(`
    SELECT max(last_seen_at) AS last_seen_at
    FROM worker_heartbeats
    WHERE stopping_at IS NULL
  `);
  const lastSeenAt = heartbeatResult.rows[0]?.last_seen_at ?? null;
  const active = Boolean(lastSeenAt && Date.now() - lastSeenAt.getTime() <= 90_000);

  return {
    ok: true,
    latencyMs: Math.round(performance.now() - startedAt),
    schemaTables: requiredTables.length,
    worker: { active, lastSeenAt: lastSeenAt?.toISOString() ?? null },
  };
}
