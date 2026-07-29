import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { splitSqlStatements } from "./sql-utils.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to run database migrations.");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(scriptDirectory, "../drizzle");
const parsedTimeout = Number.parseInt(process.env.MIGRATION_TIMEOUT_MS ?? "45000", 10);
const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 5_000 ? parsedTimeout : 45_000;
const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: Math.ceil(timeoutMs / 1_000),
  idle_timeout: 20,
  prepare: false,
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

try {
  await withTimeout(
    () =>
      sql.unsafe(
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
      () => sql`SELECT "checksum" FROM "_platform_migrations" WHERE "name" = ${name} LIMIT 1`,
      `Reading migration ${name}`,
    );

    if (existing[0]) {
      if (existing[0].checksum !== digest) {
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
      () =>
        sql.begin(async (tx) => {
          for (const statement of statements) {
            await tx.unsafe(statement);
          }
          await tx`INSERT INTO "_platform_migrations" ("name", "checksum") VALUES (${name}, ${digest})`;
        }),
      `Applying migration ${name}`,
    );

    console.log(
      JSON.stringify({ level: "info", event: "migration.applied", name, statements: statements.length }),
    );
  }

  console.log(JSON.stringify({ level: "info", event: "migrations.completed", count: migrationFiles.length }));
} finally {
  await sql.end({ timeout: 5 });
}
