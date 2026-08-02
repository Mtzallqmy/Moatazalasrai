import type { Task } from "graphile-worker";
import { cleanupSandboxWorkspaces } from "@/lib/sandbox/worker-runtime";
import { sandboxCleanupPayloadSchema } from "@/worker/schemas";

export const sandboxCleanupTask: Task = async (rawPayload, helpers) => {
  const payload = sandboxCleanupPayloadSchema.parse(rawPayload);
  const result = await cleanupSandboxWorkspaces(payload);
  helpers.logger.info(`sandbox-cleanup removed ${result.cleaned} workspaces`);
};
