import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateOptionalRuntimeEnvironment } from "./validate-runtime-env.mjs";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(scriptsDirectory, "..");
const channelSchemaScript = path.join(scriptsDirectory, "check-telegram-schema.mjs");
const telegramSetupScript = path.join(scriptsDirectory, "setup-telegram-webhook.mjs");

validateOptionalRuntimeEnvironment();

function enabled(name) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function runRequiredScript(input) {
  if (!existsSync(input.script)) {
    console.error(JSON.stringify({
      level: "fatal",
      event: `${input.event}.asset_missing`,
      asset: path.relative(applicationRoot, input.script),
    }));
    process.exit(1);
  }
  console.info(JSON.stringify({ level: "info", event: `${input.event}.started` }));
  const result = spawnSync(process.execPath, [input.script], {
    cwd: applicationRoot,
    env: process.env,
    stdio: "inherit",
    timeout: input.timeoutMs,
  });
  if (result.error || result.status !== 0) {
    console.error(JSON.stringify({
      level: "fatal",
      event: `${input.event}.failed`,
      errorName: result.error?.name ?? null,
      exitCode: result.status,
      signal: result.signal,
    }));
    process.exit(1);
  }
  console.info(JSON.stringify({ level: "info", event: `${input.event}.completed` }));
}

const telegramEnabled = enabled("TELEGRAM_INTEGRATION_ENABLED");
const whatsappEnabled = enabled("WHATSAPP_INTEGRATION_ENABLED");
if (telegramEnabled || whatsappEnabled) {
  runRequiredScript({
    event: "channel.client.schema.verification",
    script: channelSchemaScript,
    timeoutMs: 30_000,
  });
}

if (telegramEnabled) {
  const mode = process.env.TELEGRAM_UPDATE_MODE?.trim().toLowerCase() || "webhook";
  if (mode === "webhook") {
    runRequiredScript({
      event: "telegram.webhook.bootstrap",
      script: telegramSetupScript,
      timeoutMs: 70_000,
    });
  }
}

const host = process.env.APP_HOST?.trim() || process.env.HOSTNAME?.trim() || "0.0.0.0";
const port = process.env.PORT?.trim() || "3000";
const standaloneServer = path.join(applicationRoot, "server.js");
const nextBinary = path.join(applicationRoot, "node_modules/next/dist/bin/next");
const childArguments = existsSync(standaloneServer)
  ? [standaloneServer]
  : [nextBinary, "start", "-H", host, "-p", port];
let shutdownSignal;

const next = spawn(process.execPath, childArguments, {
  cwd: applicationRoot,
  env: { ...process.env, HOSTNAME: host, PORT: port },
  stdio: "inherit",
});

function shutdown(signal) {
  if (shutdownSignal) return;
  shutdownSignal = signal;
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
