import type { Task } from "graphile-worker";
import { resumeAgentRunAfterApproval } from "@/lib/ai-sdk/resume";
import { agentRunResumePayloadSchema } from "@/worker/schemas";

export const agentRunResumeTask: Task = async (rawPayload, helpers) => {
  const payload = agentRunResumePayloadSchema.parse(rawPayload);
  helpers.logger.info(`agent-run-resume started for approval ${payload.approvalId}`);
  const run = await resumeAgentRunAfterApproval(payload);
  helpers.logger.info(`agent-run-resume finished with status ${run?.status ?? "unknown"}`);
};
