import type { Task } from "graphile-worker";
import { executePersistedAgentTeamRun } from "@/lib/agents/team-runtime";
import { agentTeamRunPayloadSchema } from "@/worker/schemas";

export const agentTeamRunTask: Task = async (rawPayload, helpers) => {
  const payload = agentTeamRunPayloadSchema.parse(rawPayload);
  helpers.logger.info(`agent-team-run started for ${payload.teamRunId}`);
  const result = await executePersistedAgentTeamRun(payload);
  const status = result && typeof result === "object" && "status" in result
    ? String(result.status)
    : "unknown";
  helpers.logger.info(`agent-team-run finished with status ${status}`);
};
