import { randomUUID } from "node:crypto";
import { run, type Runner, type TaskList } from "graphile-worker";
import { db } from "@/db";
import { workerHeartbeats } from "@/db/agent-runtime-schema";
import { env } from "@/lib/config/env";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { agentTeamRunTask } from "@/worker/tasks/agent-team-run";
import { documentParseTask } from "@/worker/tasks/document-parse";

export const taskList = {
  "agent-team-run": agentTeamRunTask,
  "document-parse": documentParseTask,
} satisfies TaskList;

function workerConcurrency() {
  const configured = Number(process.env.WORKER_CONCURRENCY ?? 4);
  if (!Number.isFinite(configured)) return 4;
  return Math.min(16, Math.max(1, Math.floor(configured)));
}

const workerId = `moataz-${randomUUID()}`;
let runner: Runner | undefined;
let stopping = false;
let heartbeatTimer: NodeJS.Timeout | undefined;

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

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  console.info(JSON.stringify(safeTelemetry({ event: "worker.stopping", workerId, signal })));
  await heartbeat(new Date()).catch(() => undefined);
  await runner?.stop();
  console.info(JSON.stringify(safeTelemetry({ event: "worker.stopped", workerId, signal })));
}

async function main() {
  if (process.env.AI_WORKER_ENABLED === "false") {
    throw new Error("AI_WORKER_ENABLED must not be false for the worker service.");
  }
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

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  console.info(JSON.stringify(safeTelemetry({
    event: "worker.started",
    workerId,
    concurrency: workerConcurrency(),
    tasks: Object.keys(taskList),
  })));
  runner = await run({
    connectionString: env().databaseUrl,
    concurrency: workerConcurrency(),
    taskList,
    noHandleSignals: true,
  });
  await runner.promise;
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
