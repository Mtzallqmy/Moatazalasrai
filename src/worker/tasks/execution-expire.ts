import type { Task } from "graphile-worker";
import { expireExecutions } from "@/lib/execution/worker-runtime";
import { executionMaintenancePayloadSchema } from "@/worker/schemas";

export const executionExpireTask: Task = async (rawPayload, helpers) => {
  executionMaintenancePayloadSchema.parse(rawPayload);
  const result = await expireExecutions();
  helpers.logger.info(`execution-expire processed ${result.expired}`);
};
