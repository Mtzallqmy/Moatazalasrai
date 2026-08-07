import type { Task } from "graphile-worker";
import { cancelExecution } from "@/lib/execution/worker-runtime";
import { executionTaskPayloadSchema } from "@/worker/schemas";

export const executionCancelTask: Task = async (rawPayload, helpers) => {
  const payload = executionTaskPayloadSchema.parse(rawPayload);
  await cancelExecution({ ...payload, workerId: `execution-cancel:${process.pid}` });
  helpers.logger.info(`execution-cancel processed ${payload.jobId}`);
};
