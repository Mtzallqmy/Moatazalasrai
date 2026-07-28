import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/config/env";
import * as schema from "./schema";

function getSql() {
  return neon(env().databaseUrl);
}

function getDb() {
  return drizzle(getSql(), { schema });
}

let cached: ReturnType<typeof getDb> | null = null;

export function db() {
  if (!cached) cached = getDb();
  return cached;
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
  "audit_logs",
] as const;

export async function checkDatabase(): Promise<{
  ok: true;
  latencyMs: number;
  schemaTables: number;
}> {
  const startedAt = performance.now();
  const sql = getSql();
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
      to_regclass('public.audit_logs')::text AS audit_logs
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
