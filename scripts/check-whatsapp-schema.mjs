#!/usr/bin/env node

import pg from "pg";

const enabled = process.env.WHATSAPP_INTEGRATION_ENABLED?.trim().toLowerCase() === "true";
if (!enabled) process.exit(0);

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to verify the WhatsApp schema.");

const requiredMigrations = [
  "0028_whatsapp_business_platform.sql",
  "0038_central_whatsapp_channel.sql",
  "0042_whatsapp_user_sessions.sql",
];

const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 10_000,
});

try {
  const migrations = await pool.query(
    'SELECT "name" FROM "_platform_migrations" WHERE "name" = ANY($1::text[])',
    [requiredMigrations],
  );
  const applied = new Set(migrations.rows.map((row) => String(row.name)));
  for (const required of requiredMigrations) {
    if (!applied.has(required)) throw new Error(`Required migration ${required} has not been applied.`);
  }

  const schema = await pool.query(`
    SELECT
      to_regclass('public.whatsapp_connections') AS account_links,
      to_regclass('public.whatsapp_webhook_events') AS webhook_events,
      to_regclass('public.platform_whatsapp_endpoints') AS platform_endpoints,
      to_regclass('public.platform_whatsapp_defaults') AS platform_defaults,
      to_regclass('public.whatsapp_organization_policies') AS organization_policies,
      to_regclass('public.whatsapp_user_policies') AS user_policies,
      to_regclass('public.whatsapp_user_sessions') AS user_sessions
  `);
  const row = schema.rows[0] ?? {};
  if (
    !row.account_links
    || !row.webhook_events
    || !row.platform_endpoints
    || !row.platform_defaults
    || !row.organization_policies
    || !row.user_policies
    || !row.user_sessions
  ) {
    throw new Error("Central WhatsApp database schema is incomplete.");
  }

  console.log(JSON.stringify({
    level: "info",
    event: "whatsapp.schema.verified",
    migrations: requiredMigrations,
  }));
} finally {
  await pool.end();
}
