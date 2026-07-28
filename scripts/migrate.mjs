import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { splitSqlStatements } from "./sql-utils.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to run database migrations.");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(scriptDirectory, "../drizzle");
const parsedTimeout = Number.parseInt(process.env.MIGRATION_TIMEOUT_MS ?? "45000", 10);
const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 5_000 ? parsedTimeout : 45_000;
const sql = neon(databaseUrl);

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function withTimeout(action, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

await withTimeout(
  (signal) =>
    sql.query(
      `CREATE TABLE IF NOT EXISTS "_platform_migrations" (
        "name" text PRIMARY KEY,
        "checksum" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )`,
      [],
      { fetchOptions: { signal } },
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
    (signal) =>
      sql.query(
        `SELECT "checksum" FROM "_platform_migrations" WHERE "name" = $1 LIMIT 1`,
        [name],
        { fetchOptions: { signal } },
      ),
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
    (signal) =>
      sql.transaction(
        (tx) => [
          ...statements.map((statement) => tx`${tx.unsafe(statement)}`),
          tx`INSERT INTO "_platform_migrations" ("name", "checksum") VALUES (${name}, ${digest})`,
        ],
        { isolationMode: "Serializable", fetchOptions: { signal } },
      ),
    `Applying migration ${name}`,
  );

  console.log(
    JSON.stringify({ level: "info", event: "migration.applied", name, statements: statements.length }),
  );
}

console.log(JSON.stringify({ level: "info", event: "migrations.completed", count: migrationFiles.length }));
