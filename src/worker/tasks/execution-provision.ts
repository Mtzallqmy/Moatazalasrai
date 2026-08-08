import type { Task } from "graphile-worker";
import { provisionExecution } from "@/lib/execution/worker-runtime";
import { executionTaskPayloadSchema } from "@/worker/schemas";

export const executionProvisionTask: Task = async (rawPayload, helpers) => {
  const payload = executionTaskPayloadSchema.parse(rawPayload);
  await provisionExecution({ ...payload, workerId: `execution-provision:${process.pid}` });
  helpers.logger.info(`execution-provision processed ${payload.jobId}`);
};
