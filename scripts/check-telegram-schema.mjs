#!/usr/bin/env node

import pg from "pg";

const enabled = process.env.TELEGRAM_INTEGRATION_ENABLED?.trim().toLowerCase() === "true";
if (!enabled) process.exit(0);

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to verify the Telegram schema.");

const requiredMigrations = [
  "0039_central_telegram_bot.sql",
  "0040_telegram_admin_default_permissions.sql",
  "0041_telegram_operational_client.sql",
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
      to_regclass('public.telegram_account_links') AS account_links,
      to_regclass('public.telegram_link_codes') AS link_codes,
      to_regclass('public.telegram_feature_permissions') AS feature_permissions,
      to_regclass('public.telegram_user_sessions') AS user_sessions,
      to_regclass('public.telegram_user_sessions_telegram_chat_unique_idx') AS session_unique_idx,
      to_regclass('public.messages_conversation_client_role_unique_idx') AS message_idempotency_idx,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'telegram_updates'
          AND column_name = 'integration_id'
          AND is_nullable = 'YES'
      ) AS central_updates_ready,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'telegram_updates'
          AND column_name = 'payload'
          AND data_type = 'jsonb'
      ) AS payload_ready,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'telegram_user_sessions'
          AND column_name = 'version'
          AND is_nullable = 'NO'
      ) AS optimistic_lock_ready
  `);
  const row = schema.rows[0] ?? {};
  if (
    !row.account_links
    || !row.link_codes
    || !row.feature_permissions
    || !row.user_sessions
    || !row.session_unique_idx
    || !row.message_idempotency_idx
    || row.central_updates_ready !== true
    || row.payload_ready !== true
    || row.optimistic_lock_ready !== true
  ) {
    throw new Error("Central Telegram operational database schema is incomplete.");
  }

  console.log(JSON.stringify({
    level: "info",
    event: "telegram.schema.verified",
    migrations: requiredMigrations,
    durableUpdates: true,
    optimisticSessions: true,
    messageIdempotency: true,
  }));
} finally {
  await pool.end();
}
