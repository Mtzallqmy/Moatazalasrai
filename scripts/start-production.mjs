import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const host = process.env.HOSTNAME?.trim() || "0.0.0.0";
const port = process.env.PORT?.trim() || "3000";
const nextBinary = "node_modules/next/dist/bin/next";
let shuttingDown = false;

function runNodeScript(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: process.env,
      stdio: "inherit",
    });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`${script} exceeded ${timeoutMs}ms`)));
    }, timeoutMs);

    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`${script} exited with code ${code ?? "unknown"} (${signal ?? "no signal"})`));
      });
    });
  });
}

async function prepareDatabase() {
  let attempt = 0;
  while (!shuttingDown) {
    attempt += 1;
    try {
      console.log(JSON.stringify({ level: "info", event: "database.prepare.started", attempt }));
      await runNodeScript("scripts/migrate.mjs", 60_000);
      await runNodeScript("scripts/bootstrap-owner.mjs", 45_000);
      console.log(JSON.stringify({ level: "info", event: "database.prepare.completed", attempt }));
      return;
    } catch (error) {
      const delayMs = Math.min(30_000, 2_000 * 2 ** Math.min(attempt - 1, 4));
      console.error(
        JSON.stringify({
          level: "error",
          event: "database.prepare.failed",
          attempt,
          retryInMs: delayMs,
          message: error instanceof Error ? error.message : "Unknown preparation error",
        }),
      );
      await sleep(delayMs);
    }
  }
}

const next = spawn(process.execPath, [nextBinary, "start", "-H", host, "-p", port], {
  env: process.env,
  stdio: "inherit",
});

void prepareDatabase();

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  next.kill(signal);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

next.once("error", (error) => {
  console.error(JSON.stringify({ level: "fatal", event: "next.start.failed", message: error.message }));
  process.exitCode = 1;
});

next.once("exit", (code, signal) => {
  shuttingDown = true;
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
