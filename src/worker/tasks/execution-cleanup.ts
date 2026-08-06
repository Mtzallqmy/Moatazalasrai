import type { Task } from "graphile-worker";
import { cleanupExecution } from "@/lib/execution/worker-runtime";
import { executionTaskPayloadSchema } from "@/worker/schemas";

export const executionCleanupTask: Task = async (rawPayload, helpers) => {
  const payload = executionTaskPayloadSchema.parse(rawPayload);
  await cleanupExecution({ ...payload, workerId: `execution-cleanup:${process.pid}` });
  helpers.logger.info(`execution-cleanup processed ${payload.jobId}`);
};
