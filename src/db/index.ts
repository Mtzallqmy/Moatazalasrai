import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon's HTTP driver talks to the database over plain HTTPS (fetch),
 * not the raw Postgres wire protocol. That is deliberate: it is what
 * makes this app portable to edge runtimes (Cloudflare Workers/Pages)
 * as well as any standard Node host (Railway, Render, Docker, ...).
 *
 * DATABASE_URL must be set (see .env.example). We only create the
 * client lazily so `next build` and unit tests never require a live
 * database connection.
 */
function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string."
    );
  }
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

let cached: ReturnType<typeof getDb> | null = null;

export function db() {
  if (!cached) cached = getDb();
  return cached;
}
