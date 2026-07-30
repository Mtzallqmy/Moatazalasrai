import { z } from "zod";

const uuid = z.string().uuid();

export const agentTeamRunPayloadSchema = z.object({
  organizationId: uuid,
  teamRunId: uuid,
}).strict();

export const documentParsePayloadSchema = z.object({
  organizationId: uuid,
  documentId: uuid,
}).strict();

export type AgentTeamRunPayload = z.infer<typeof agentTeamRunPayloadSchema>;
export type DocumentParsePayload = z.infer<typeof documentParsePayloadSchema>;

export const supportedWorkerTasks = ["agent-team-run", "document-parse"] as const;
export type SupportedWorkerTask = typeof supportedWorkerTasks[number];
