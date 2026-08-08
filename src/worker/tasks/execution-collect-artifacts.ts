import type { Task } from "graphile-worker";
import { collectExecutionArtifacts } from "@/lib/execution/worker-runtime";
import { executionTaskPayloadSchema } from "@/worker/schemas";

export const executionCollectArtifactsTask: Task = async (rawPayload, helpers) => {
  const payload = executionTaskPayloadSchema.parse(rawPayload);
  await collectExecutionArtifacts({ ...payload, workerId: `execution-artifacts:${process.pid}` });
  helpers.logger.info(`execution-collect-artifacts processed ${payload.jobId}`);
};
