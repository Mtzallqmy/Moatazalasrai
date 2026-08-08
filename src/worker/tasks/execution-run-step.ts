import type { Task } from "graphile-worker";
import { runExecutionStep } from "@/lib/execution/worker-runtime";
import { executionTaskPayloadSchema } from "@/worker/schemas";

export const executionRunStepTask: Task = async (rawPayload, helpers) => {
  const payload = executionTaskPayloadSchema.parse(rawPayload);
  await runExecutionStep({ ...payload, workerId: `execution-run:${process.pid}` });
  helpers.logger.info(`execution-run-step processed ${payload.jobId}`);
};
