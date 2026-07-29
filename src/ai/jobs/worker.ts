import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { claimJobs, executeClaimedJob } from "./service";
const workerId = `worker-${randomUUID()}`;
const pollMs = Math.max(250, Number(process.env.JOB_POLL_INTERVAL_MS ?? 2000));
const lockMs = Math.max(30_000, Number(process.env.JOB_LOCK_TIMEOUT_MS ?? 300_000));
const batch = Math.min(20, Math.max(1, Number(process.env.JOB_BATCH_SIZE ?? 5)));
if (process.env.AI_WORKER_ENABLED !== "true") throw new Error("AI_WORKER_ENABLED must be true");
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
async function main() {
  console.info(JSON.stringify({ event: "worker.started", workerId }));
  while (!stopping) {
    try {
      const jobs = await claimJobs(workerId, batch, lockMs);
      for (const job of jobs) await executeClaimedJob(job);
      if (!jobs.length) await sleep(pollMs);
    } catch (error) {
      console.error(JSON.stringify({ event: "worker.tick.failed", workerId, errorCode: error instanceof Error ? error.name : "UNKNOWN" }));
      await sleep(Math.min(10_000, pollMs * 2));
    }
  }
  console.info(JSON.stringify({ event: "worker.stopped", workerId }));
}
void main();
