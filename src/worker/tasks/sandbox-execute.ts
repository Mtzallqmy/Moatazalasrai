import type { Task } from "graphile-worker";
import { executeSandboxExecution } from "@/lib/sandbox/worker-runtime";
import { sandboxExecutionPayloadSchema } from "@/worker/schemas";

export const sandboxExecuteTask: Task = async (rawPayload, helpers) => {
  const payload = sandboxExecutionPayloadSchema.parse(rawPayload);
  const execution = await executeSandboxExecution(payload);
  helpers.logger.info(`sandbox-execute finished with status ${execution?.status ?? "unknown"}`);
};
