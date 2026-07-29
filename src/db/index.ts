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
] as const;

export async function checkDatabase(): Promise<{
  ok: true;
  latencyMs: number;
  schemaTables: number;
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
      to_regclass('public.rate_limits')::text AS rate_limits
      ,to_regclass('public.integrations')::text AS integrations
      ,to_regclass('public.telegram_chats')::text AS telegram_chats
      ,to_regclass('public.telegram_updates')::text AS telegram_updates
      ,to_regclass('public.attachments')::text AS attachments
      ,to_regclass('public.agent_memories')::text AS agent_memories
      ,to_regclass('public.knowledge_bases')::text AS knowledge_bases
      ,to_regclass('public.knowledge_documents')::text AS knowledge_documents
      ,to_regclass('public.knowledge_chunks')::text AS knowledge_chunks
      ,to_regclass('public.background_jobs')::text AS background_jobs
      ,to_regclass('public.tool_approvals')::text AS tool_approvals
  `;
  const state = rows[0] as Record<string, string | null> | undefined;
  const missingTables = requiredTables.filter((table) => !state?.[table]);

  if (missingTables.length > 0) {
    throw new Error(`Database schema is incomplete: ${missingTables.join(", ")}`);
  }

  return {
    ok: true,
    latencyMs: Math.round(performance.now() - startedAt),
    schemaTables: requiredTables.length,
  };
}
