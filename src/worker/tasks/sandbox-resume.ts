import type { Task } from "graphile-worker";
import { resumeSandboxExecution } from "@/lib/sandbox/worker-runtime";
import { sandboxResumePayloadSchema } from "@/worker/schemas";

export const sandboxResumeTask: Task = async (rawPayload, helpers) => {
  const payload = sandboxResumePayloadSchema.parse(rawPayload);
  const execution = await resumeSandboxExecution(payload);
  helpers.logger.info(`sandbox-resume finished with status ${execution?.status ?? "unknown"}`);
};
