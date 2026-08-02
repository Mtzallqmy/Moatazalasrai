import type { Task } from "graphile-worker";
import { resetSandboxWorkspaceRuntime } from "@/lib/sandbox/worker-runtime";
import { sandboxWorkspacePayloadSchema } from "@/worker/schemas";

export const sandboxResetTask: Task = async (rawPayload, helpers) => {
  const payload = sandboxWorkspacePayloadSchema.parse(rawPayload);
  const workspace = await resetSandboxWorkspaceRuntime(payload);
  helpers.logger.info(`sandbox-reset finished with status ${workspace?.status ?? "unknown"}`);
};
