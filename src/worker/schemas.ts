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

export const agentRunResumePayloadSchema = z.object({
  organizationId: uuid,
  approvalId: z.string().min(1).max(200),
}).strict();

export type AgentTeamRunPayload = z.infer<typeof agentTeamRunPayloadSchema>;
export type DocumentParsePayload = z.infer<typeof documentParsePayloadSchema>;
export type AgentRunResumePayload = z.infer<typeof agentRunResumePayloadSchema>;

export const supportedWorkerTasks = ["agent-team-run", "document-parse", "agent-run-resume"] as const;
export type SupportedWorkerTask = typeof supportedWorkerTasks[number];
