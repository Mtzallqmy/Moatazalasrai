import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSqlStatements } from "./sql-utils.mjs";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to run database migrations.");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(scriptDirectory, "../drizzle");
const parsedTimeout = Number.parseInt(process.env.MIGRATION_TIMEOUT_MS ?? "45000", 10);
const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 5_000 ? parsedTimeout : 45_000;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: timeoutMs,
  idleTimeoutMillis: 20_000,
});

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function withTimeout(action, label) {
  let timeout;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function applyMigration(name, digest, statements) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runtimeRole = await client.query(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moataz_app_runtime') AS available",
    );
    if (runtimeRole.rows[0]?.available) {
      await client.query("SET LOCAL ROLE moataz_app_runtime");
      await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
    }
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query(
      'INSERT INTO "_platform_migrations" ("name", "checksum") VALUES ($1, $2)',
      [name, digest],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

try {
  await withTimeout(
    () =>
      pool.query(
        `CREATE TABLE IF NOT EXISTS "_platform_migrations" (
          "name" text PRIMARY KEY,
          "checksum" text NOT NULL,
          "applied_at" timestamptz NOT NULL DEFAULT now()
        )`,
      ),
    "Creating migration metadata table",
  );

  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (migrationFiles.length === 0) {
    throw new Error(`No SQL migration files were found in ${migrationDirectory}.`);
  }

  for (const name of migrationFiles) {
    const content = await readFile(path.join(migrationDirectory, name), "utf8");
    const digest = checksum(content);
    const existing = await withTimeout(
      () => pool.query('SELECT "checksum" FROM "_platform_migrations" WHERE "name" = $1 LIMIT 1', [name]),
      `Reading migration ${name}`,
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== digest) {
        throw new Error(`Migration ${name} was already applied with a different checksum.`);
      }
      console.log(JSON.stringify({ level: "info", event: "migration.skipped", name }));
      continue;
    }

    const statements = splitSqlStatements(content);
    if (statements.length === 0) {
      throw new Error(`Migration ${name} does not contain executable SQL.`);
    }

    await withTimeout(
      () => applyMigration(name, digest, statements),
      `Applying migration ${name}`,
    );

    console.log(
      JSON.stringify({ level: "info", event: "migration.applied", name, statements: statements.length }),
    );
  }

  console.log(JSON.stringify({ level: "info", event: "migrations.completed", count: migrationFiles.length }));
} finally {
  await pool.end();
}
