import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { env } from "@/lib/config/env";
import type { AgentTeamRunPayload, DocumentParsePayload } from "@/worker/schemas";

let workerUtilsPromise: Promise<WorkerUtils> | null = null;

export function getWorkerUtils() {
  if (!workerUtilsPromise) {
    workerUtilsPromise = makeWorkerUtils({ connectionString: env().databaseUrl }).catch((error) => {
      workerUtilsPromise = null;
      throw error;
    });
  }
  return workerUtilsPromise;
}

export async function releaseWorkerUtils() {
  const promise = workerUtilsPromise;
  workerUtilsPromise = null;
  if (promise) await (await promise).release();
}

export async function enqueueAgentTeamRun(payload: AgentTeamRunPayload) {
  const worker = await getWorkerUtils();
  const job = await worker.addJob("agent-team-run", payload, {
    queueName: "agent-teams",
    maxAttempts: 5,
    jobKey: `agent-team-run:${payload.teamRunId}`,
    jobKeyMode: "unsafe_dedupe",
  });
  return { jobId: String(job.id) };
}

export async function enqueueDocumentParse(payload: DocumentParsePayload) {
  const worker = await getWorkerUtils();
  const job = await worker.addJob("document-parse", payload, {
    queueName: "rag",
    maxAttempts: 5,
    jobKey: `document-parse:${payload.documentId}`,
    jobKeyMode: "replace",
  });
  return { jobId: String(job.id) };
}
