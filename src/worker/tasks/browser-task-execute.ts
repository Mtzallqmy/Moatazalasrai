import type { Task } from "graphile-worker";
import { executeBrowserTaskRuntime } from "@/lib/browser/worker-runtime";
import { browserTaskPayloadSchema } from "@/worker/schemas";

export const browserTaskExecuteTask: Task = async (rawPayload, helpers) => {
  const payload = browserTaskPayloadSchema.parse(rawPayload);
  const task = await executeBrowserTaskRuntime(payload);
  helpers.logger.info(`browser-task-execute finished with status ${task?.status ?? "unknown"}`);
};
