import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { validateOptionalRuntimeEnvironment } from "./validate-runtime-env.mjs";

validateOptionalRuntimeEnvironment();

const host = process.env.APP_HOST?.trim() || process.env.HOSTNAME?.trim() || "0.0.0.0";
const port = process.env.PORT?.trim() || "3000";
const standaloneServer = path.resolve("server.js");
const nextBinary = "node_modules/next/dist/bin/next";
const childArguments = existsSync(standaloneServer)
  ? [standaloneServer]
  : [nextBinary, "start", "-H", host, "-p", port];
let shutdownSignal;

const next = spawn(process.execPath, childArguments, {
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
