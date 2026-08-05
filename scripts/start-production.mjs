import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateOptionalRuntimeEnvironment } from "./validate-runtime-env.mjs";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(scriptsDirectory, "..");
const telegramSetupScript = path.join(scriptsDirectory, "setup-telegram-webhook.mjs");

validateOptionalRuntimeEnvironment();

function enabled(name) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function telegramWebhookEnabled() {
  const mode = process.env.TELEGRAM_UPDATE_MODE?.trim().toLowerCase() || "webhook";
  return enabled("TELEGRAM_INTEGRATION_ENABLED") && mode !== "polling";
}

function bootstrapTelegramWebhook(attempt) {
  if (!telegramWebhookEnabled()) return true;
  if (!existsSync(telegramSetupScript)) {
    console.error(JSON.stringify({
      level: "error",
      event: "telegram.webhook.bootstrap.asset_missing",
      asset: "scripts/setup-telegram-webhook.mjs",
      attempt,
    }));
    return false;
  }

  console.info(JSON.stringify({ level: "info", event: "telegram.webhook.bootstrap.started", attempt }));
  const result = spawnSync(process.execPath, [telegramSetupScript], {
    cwd: applicationRoot,
    env: process.env,
    stdio: "inherit",
    timeout: 70_000,
  });
  if (result.error || result.status !== 0) {
    console.error(JSON.stringify({
      level: "error",
      event: "telegram.webhook.bootstrap.failed",
      errorName: result.error?.name ?? null,
      exitCode: result.status,
      signal: result.signal,
      attempt,
    }));
    return false;
  }
  console.info(JSON.stringify({ level: "info", event: "telegram.webhook.bootstrap.completed", attempt }));
  return true;
}

const host = process.env.APP_HOST?.trim() || process.env.HOSTNAME?.trim() || "0.0.0.0";
const port = process.env.PORT?.trim() || "3000";
const standaloneServer = path.join(applicationRoot, "server.js");
const nextBinary = path.join(applicationRoot, "node_modules/next/dist/bin/next");
const childArguments = existsSync(standaloneServer)
  ? [standaloneServer]
  : [nextBinary, "start", "-H", host, "-p", port];
let shutdownSignal;
let telegramTimer;
let telegramAttempt = 0;

const next = spawn(process.execPath, childArguments, {
  cwd: applicationRoot,
  env: { ...process.env, HOSTNAME: host, PORT: port },
  stdio: "inherit",
});

function scheduleTelegramBootstrap(delayMs = 0) {
  if (!telegramWebhookEnabled() || shutdownSignal) return;
  if (telegramTimer) clearTimeout(telegramTimer);
  telegramTimer = setTimeout(() => {
    if (shutdownSignal) return;
    telegramAttempt += 1;
    const succeeded = bootstrapTelegramWebhook(telegramAttempt);
    if (succeeded) {
      telegramAttempt = 0;
      // Reassert the webhook periodically so rotated secrets and repaired DNS self-heal.
      scheduleTelegramBootstrap(6 * 60 * 60_000);
      return;
    }
    const retryDelay = Math.min(15 * 60_000, 30_000 * (2 ** Math.min(telegramAttempt - 1, 5)));
    console.warn(JSON.stringify({
      level: "warn",
      event: "telegram.webhook.bootstrap.retry_scheduled",
      retryDelayMs: retryDelay,
      attempt: telegramAttempt,
    }));
    scheduleTelegramBootstrap(retryDelay);
  }, delayMs);
  telegramTimer.unref?.();
}

// Do not make the entire web service depend on an external Telegram API call.
// The application becomes healthy first, then the central webhook configures and self-heals.
scheduleTelegramBootstrap(1_000);

function shutdown(signal) {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  if (telegramTimer) clearTimeout(telegramTimer);
  console.info(JSON.stringify({ level: "info", event: "process.shutdown.requested", signal }));
  if (!next.killed) next.kill(signal);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

next.once("error", (error) => {
  console.error(JSON.stringify({ level: "fatal", event: "next.start.failed", errorName: error.name }));
  process.exit(1);
});

next.once("exit", (code, signal) => {
  console.info(JSON.stringify({
    level: shutdownSignal ? "info" : "error",
    event: "next.process.exited",
    code,
    signal,
    expectedShutdown: Boolean(shutdownSignal),
  }));
  process.exit(shutdownSignal ? 0 : (code ?? 1));
});
