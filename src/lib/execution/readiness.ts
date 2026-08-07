import { getPostgresPool } from "@/db/pool";
import { listExecutionRunners } from "@/lib/execution/runner-registry";

export const EXECUTION_KERNEL_TABLES = [
  "execution_jobs",
  "execution_workspaces",
  "execution_steps",
  "execution_events",
  "execution_artifacts",
  "execution_usage",
] as const;

export async function checkExecutionKernelReadiness() {
  const pool = getPostgresPool();
  const result = await pool.query<{ table_name: string; present: boolean }>(`
    SELECT required.table_name,
           to_regclass('public.' || required.table_name) IS NOT NULL AS present
    FROM unnest($1::text[]) AS required(table_name)
  `, [[...EXECUTION_KERNEL_TABLES]]);
  const missingTables = result.rows.filter((row) => !row.present).map((row) => row.table_name);
  const runners = await Promise.all(listExecutionRunners().map(async (runner) => ({
    kind: runner.kind,
    ...(await runner.health()),
  })));
  const unhealthyRunners = runners.filter((runner) => !runner.ok);
  return {
    ready: missingTables.length === 0 && unhealthyRunners.length === 0,
    missingTables,
    runners,
  };
}

export async function assertExecutionKernelReady() {
  const readiness = await checkExecutionKernelReadiness();
  if (!readiness.ready) {
    const details = [
      readiness.missingTables.length ? `missing tables: ${readiness.missingTables.join(", ")}` : null,
      readiness.runners.filter((runner) => !runner.ok).map((runner) => `${runner.kind}: ${runner.detail ?? "unhealthy"}`).join("; ") || null,
    ].filter(Boolean).join(" | ");
    throw new Error(`EXECUTION_KERNEL_NOT_READY${details ? `: ${details}` : ""}`);
  }
  return readiness;
}
