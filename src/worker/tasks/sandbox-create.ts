import type { Task } from "graphile-worker";
import { provisionSandboxWorkspace } from "@/lib/sandbox/worker-runtime";
import { sandboxWorkspacePayloadSchema } from "@/worker/schemas";

export const sandboxCreateTask: Task = async (rawPayload, helpers) => {
  const payload = sandboxWorkspacePayloadSchema.parse(rawPayload);
  const workspace = await provisionSandboxWorkspace(payload);
  helpers.logger.info(`sandbox-create finished with status ${workspace?.status ?? "unknown"}`);
};
