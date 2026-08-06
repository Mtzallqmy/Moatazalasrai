#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(scriptsDirectory, "..");
const bundledWorker = path.join(applicationRoot, "dist", "worker.mjs");
const sourceWorker = path.join(applicationRoot, "src", "worker", "index.ts");

const args = existsSync(bundledWorker)
  ? [bundledWorker]
  : ["--import", "tsx", sourceWorker];

if (!existsSync(bundledWorker) && !existsSync(sourceWorker)) {
  console.error(JSON.stringify({
    level: "fatal",
    event: "worker.runtime.asset_missing",
    expected: ["dist/worker.mjs", "src/worker/index.ts"],
  }));
  process.exit(1);
}

console.info(JSON.stringify({
  level: "info",
  event: "worker.runtime.starting",
  mode: existsSync(bundledWorker) ? "bundle" : "source",
}));

const child = spawn(process.execPath, args, {
  cwd: applicationRoot,
  env: process.env,
  stdio: "inherit",
});

let shutdownSignal;
function shutdown(signal) {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  if (!child.killed) child.kill(signal);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

child.once("error", (error) => {
  console.error(JSON.stringify({ level: "fatal", event: "worker.runtime.start_failed", errorName: error.name }));
  process.exit(1);
});

child.once("exit", (code, signal) => {
  console.info(JSON.stringify({
    level: shutdownSignal ? "info" : "error",
    event: "worker.runtime.exited",
    code,
    signal,
    expectedShutdown: Boolean(shutdownSignal),
  }));
  process.exit(shutdownSignal ? 0 : (code ?? 1));
});
