import { spawn } from "node:child_process";
import { validateOptionalRuntimeEnvironment } from "./validate-runtime-env.mjs";

validateOptionalRuntimeEnvironment();

const host = process.env.APP_HOST?.trim() || "0.0.0.0";
const port = process.env.PORT?.trim() || "3000";
const nextBinary = "node_modules/next/dist/bin/next";
let shutdownSignal;

const next = spawn(process.execPath, [nextBinary, "start", "-H", host, "-p", port], {
  env: process.env,
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
