import { randomUUID } from "node:crypto";
import { run, type Runner } from "graphile-worker";
import { db } from "@/db";
import { closePostgresPool, getPostgresPool } from "@/db/pool";
import { workerHeartbeats } from "@/db/agent-runtime-schema";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { startNodeTelemetry } from "@/ai/observability/node-otel";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { taskList } from "@/worker/task-list";

function workerConcurrency() {
  const configured = Number(process.env.WORKER_CONCURRENCY ?? 4);
  if (!Number.isFinite(configured)) return 4;
  return Math.min(16, Math.max(1, Math.floor(configured)));
}

const workerId = `moataz-${randomUUID()}`;
let runner: Runner | undefined;
let stopping = false;
let heartbeatTimer: NodeJS.Timeout | undefined;
let runtimeControlTimer: NodeJS.Timeout | undefined;
let telemetryShutdown: (() => Promise<void>) | undefined;

async function heartbeat(stoppingAt?: Date) {
  await db().insert(workerHeartbeats).values({
    workerId,
    lastSeenAt: new Date(),
    stoppingAt,
    metadata: { concurrency: workerConcurrency(), taskCount: Object.keys(taskList).length },
  }).onConflictDoUpdate({
    target: workerHeartbeats.workerId,
    set: {
      lastSeenAt: new Date(),
      stoppingAt: stoppingAt ?? null,
      metadata: { concurrency: workerConcurrency(), taskCount: Object.keys(taskList).length },
    },
  });
}

async function refreshRuntimeControl() {
  await hydrateRuntimeControlPlane(true).catch((error) => {
    console.error(JSON.stringify(safeTelemetry({
      event: "worker.runtime_control.refresh_failed",
      workerId,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    })));
  });
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (runtimeControlTimer) clearInterval(runtimeControlTimer);
  console.info(JSON.stringify(safeTelemetry({ event: "worker.stopping", workerId, signal })));
  await heartbeat(new Date()).catch(() => undefined);
  await runner?.stop();
  await telemetryShutdown?.().catch(() => undefined);
  await closePostgresPool().catch(() => undefined);
  console.info(JSON.stringify(safeTelemetry({ event: "worker.stopped", workerId, signal })));
}

async function main() {
  if (process.env.AI_WORKER_ENABLED === "false") {
    throw new Error("AI_WORKER_ENABLED must not be false for the worker service.");
  }
  await refreshRuntimeControl();
  telemetryShutdown = await startNodeTelemetry("moataz-worker");
  await heartbeat();
  heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      console.error(JSON.stringify(safeTelemetry({
        event: "worker.heartbeat.failed",
        workerId,
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
      })));
    });
  }, 30_000);
  heartbeatTimer.unref();
  runtimeControlTimer = setInterval(() => { void refreshRuntimeControl(); }, 5_000);
  runtimeControlTimer.unref();

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  console.info(JSON.stringify(safeTelemetry({
    event: "worker.started",
    workerId,
    concurrency: workerConcurrency(),
    tasks: Object.keys(taskList),
  })));
  runner = await run({
    pgPool: getPostgresPool(),
    concurrency: workerConcurrency(),
    taskList,
    noHandleSignals: true,
  });
  await runner.promise;
  if (!stopping) await shutdown("runner-complete");
}

void main().catch(async (error) => {
  console.error(JSON.stringify(safeTelemetry({
    event: "worker.failed",
    workerId,
    errorCode: error instanceof Error ? error.name : "UNKNOWN",
  })));
  await shutdown("fatal").catch(() => undefined);
  process.exitCode = 1;
});
