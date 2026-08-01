import { spawn } from "node:child_process";
import { validateOptionalRuntimeEnvironment } from "./validate-runtime-env.mjs";

validateOptionalRuntimeEnvironment();

const host = process.env.APP_HOST?.trim() || "0.0.0.0";
const port = process.env.PORT?.trim() || "3000";
const nextBinary = "node_modules/next/dist/bin/next";
const next = spawn(process.execPath, [nextBinary, "start", "-H", host, "-p", port], {
  env: process.env,
  stdio: "inherit",
});

function shutdown(signal) {
  if (!next.killed) next.kill(signal);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

next.once("error", (error) => {
  console.error(JSON.stringify({ level: "fatal", event: "next.start.failed", errorName: error.name }));
  process.exit(1);
});

next.once("exit", (code) => process.exit(code ?? 1));
