import { runMigrations } from "graphile-worker";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required to migrate Graphile Worker.");

await runMigrations({ connectionString });
console.log(JSON.stringify({ level: "info", event: "graphile.migrations.completed" }));
