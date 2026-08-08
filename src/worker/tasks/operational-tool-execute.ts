import type { Task } from "graphile-worker";
import { z } from "zod";
import { executeOperationalTool } from "@/lib/tools/operational-tool-runtime";

const payloadSchema = z.object({
  organizationId: z.string().uuid(),
  jobId: z.string().uuid(),
  toolRunId: z.string().uuid(),
}).strict();

export const operationalToolExecuteTask: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  await executeOperationalTool(payload);
  helpers.logger.info(`operational-tool-execute processed ${payload.jobId}`);
};
