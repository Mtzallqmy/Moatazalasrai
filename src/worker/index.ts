import { randomUUID } from "node:crypto";
import { run, type Runner } from "graphile-worker";
import { db } from "@/db";
import { closePostgresPool, configureDatabaseProcessKind, getSystemPostgresPool } from "@/db/pool";
import { workerHeartbeats } from "@/db/agent-runtime-schema";
import { recoverPendingDomainEvents } from "@/lib/events/recover";
import { executionKernelEnabled } from "@/lib/execution/runner-registry";
import { reconcileCentralTelegramWebhook } from "@/lib/integrations/telegram-webhook-reconciler";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { initializeWhatsAppFromEnvironment } from "@/lib/platform/whatsapp-environment";
import { startNodeTelemetry } from "@/ai/observability/node-otel";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { enqueueExecutionExpire, enqueueExecutionReconcile } from "@/worker/queue";
import { taskList } from "@/worker/task-list";

configureDatabaseProcessKind("worker");

function workerConcurrency() {
  const configured = Number(process.env.WORKER_CONCURRENCY ?? 4);
  if (!Number.isFinite(configured)) return 4;
  return Math.min(16, Math.max(1, Math.floor(configured)));
}

function executionMaintenanceInterval() {
  const configured = Number(process.env.EXECUTION_RECONCILE_INTERVAL_SECONDS ?? 60);
  const seconds = Number.isSafeInteger(configured) ? Math.min(Math.max(configured, 30), 900) : 60;
  return seconds * 1_000;
}

function telegramReconcileInterval() {
  const configured = Number(process.env.TELEGRAM_WEBHOOK_RECONCILE_SECONDS ?? 300);
  const seconds = Number.isSafeInteger(configured) ? Math.min(Math.max(configured, 60), 3600) : 300;
  return seconds * 1_000;
}

const workerId = `moataz-${randomUUID()}`;
let runner: Runner | undefined;
let stopping = false;
let heartbeatTimer: NodeJS.Timeout | undefined;
let runtimeControlTimer: NodeJS.Timeout | undefined;
let outboxRecoveryTimer: NodeJS.Timeout | undefined;
let executionMaintenanceTimer: NodeJS.Timeout | undefined;
let telegramReconcileTimer: NodeJS.Timeout | undefined;
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
  await initializeWhatsAppFromEnvironment().catch((error) => {
    console.error(JSON.stringify(safeTelemetry({
      event: "worker.whatsapp_environment.refresh_failed",
      workerId,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    })));
  });
  await hydrateRuntimeControlPlane(true).catch((error) => {
    console.error(JSON.stringify(safeTelemetry({
      event: "worker.runtime_control.refresh_failed",
      workerId,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    })));
  });
}

async function reconcileTelegram(force = false) {
  const result = await reconcileCentralTelegramWebhook({ force });
  if (result.enabled && result.configured) {
    console.info(JSON.stringify(safeTelemetry({
      event: result.repaired ? "worker.telegram_webhook.repaired" : "worker.telegram_webhook.verified",
      workerId,
      botUsername: result.botUsername,
      pendingUpdateCount: result.pendingUpdateCount,
      lastErrorMessage: result.lastErrorMessage,
    })));
  }
}

async function recoverOutbox() {
  const result = await recoverPendingDomainEvents();
  if (result.scanned || result.failed) {
    console.info(JSON.stringify(safeTelemetry({ event: "worker.notification_outbox.recovered", workerId, ...result })));
  }
}

async function scheduleExecutionMaintenance() {
  if (!executionKernelEnabled()) return;
  const requestedAt = new Date().toISOString();
  await Promise.all([
    enqueueExecutionReconcile({ requestedAt }),
    enqueueExecutionExpire({ requestedAt }),
  ]);
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (runtimeControlTimer) clearInterval(runtimeControlTimer);
  if (outboxRecoveryTimer) clearInterval(outboxRecoveryTimer);
  if (executionMaintenanceTimer) clearInterval(executionMaintenanceTimer);
  if (telegramReconcileTimer) clearInterval(telegramReconcileTimer);
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
  await initializeWhatsAppFromEnvironment({ force: true });
  await refreshRuntimeControl();
  await reconcileTelegram(true).catch((error) => {
    console.error(JSON.stringify(safeTelemetry({
      event: "worker.telegram_webhook.reconcile_failed",
      workerId,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    })));
  });
  telemetryShutdown = await startNodeTelemetry("moataz-worker");
  await heartbeat();
  await recoverOutbox().catch((error) => {
    console.error(JSON.stringify(safeTelemetry({ event: "worker.notification_outbox.recovery_failed", workerId, errorCode: error instanceof Error ? error.name : "UNKNOWN" })));
  });
  await scheduleExecutionMaintenance().catch((error) => {
    console.error(JSON.stringify(safeTelemetry({ event: "worker.execution_maintenance.enqueue_failed", workerId, errorCode: error instanceof Error ? error.name : "UNKNOWN" })));
  });
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
  outboxRecoveryTimer = setInterval(() => {
    void recoverOutbox().catch((error) => {
      console.error(JSON.stringify(safeTelemetry({ event: "worker.notification_outbox.recovery_failed", workerId, errorCode: error instanceof Error ? error.name : "UNKNOWN" })));
    });
  }, 60_000);
  outboxRecoveryTimer.unref();
  executionMaintenanceTimer = setInterval(() => {
    void scheduleExecutionMaintenance().catch((error) => {
      console.error(JSON.stringify(safeTelemetry({ event: "worker.execution_maintenance.enqueue_failed", workerId, errorCode: error instanceof Error ? error.name : "UNKNOWN" })));
    });
  }, executionMaintenanceInterval());
  executionMaintenanceTimer.unref();
  telegramReconcileTimer = setInterval(() => {
    void reconcileTelegram().catch((error) => {
      console.error(JSON.stringify(safeTelemetry({
        event: "worker.telegram_webhook.reconcile_failed",
        workerId,
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
      })));
    });
  }, telegramReconcileInterval());
  telegramReconcileTimer.unref();

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  console.info(JSON.stringify(safeTelemetry({
    event: "worker.started",
    workerId,
    concurrency: workerConcurrency(),
    tasks: Object.keys(taskList),
    executionKernelEnabled: executionKernelEnabled(),
  })));
  runner = await run({
    pgPool: getSystemPostgresPool(),
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
