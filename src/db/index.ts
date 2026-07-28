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

export async function checkDatabase(): Promise<{ ok: true; latencyMs: number }> {
  const startedAt = performance.now();
  const sql = getSql();
  await sql`select 1 as ok`;
  return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
}
