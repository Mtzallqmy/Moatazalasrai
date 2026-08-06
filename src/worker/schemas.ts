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

export const sandboxWorkspacePayloadSchema = z.object({
  organizationId: uuid,
  workspaceId: uuid,
}).strict();

export const sandboxExecutionPayloadSchema = z.object({
  organizationId: uuid,
  executionId: uuid,
}).strict();

export const sandboxResumePayloadSchema = z.object({
  organizationId: uuid,
  approvalId: z.string().uuid(),
  executionId: uuid,
}).strict();

export const sandboxCleanupPayloadSchema = z.object({
  organizationId: uuid.optional(),
}).strict();

export const browserTaskPayloadSchema = z.object({
  organizationId: uuid,
  browserTaskId: uuid,
}).strict();

export const browserResumePayloadSchema = z.object({
  organizationId: uuid,
  approvalId: z.string().uuid(),
  browserTaskId: uuid,
}).strict();

export const notificationDispatchPayloadSchema = z.object({
  organizationId: uuid,
  eventId: uuid,
}).strict();

export const telegramUpdatePayloadSchema = z.object({
  updateRowId: uuid,
  update: z.record(z.string(), z.unknown()),
}).strict();

export const whatsappChannelUpdatePayloadSchema = z.object({
  eventRowId: uuid,
  message: z.record(z.string(), z.unknown()),
}).strict();

export type AgentTeamRunPayload = z.infer<typeof agentTeamRunPayloadSchema>;
export type DocumentParsePayload = z.infer<typeof documentParsePayloadSchema>;
export type AgentRunResumePayload = z.infer<typeof agentRunResumePayloadSchema>;
export type SandboxWorkspacePayload = z.infer<typeof sandboxWorkspacePayloadSchema>;
export type SandboxExecutionPayload = z.infer<typeof sandboxExecutionPayloadSchema>;
export type SandboxResumePayload = z.infer<typeof sandboxResumePayloadSchema>;
export type SandboxCleanupPayload = z.infer<typeof sandboxCleanupPayloadSchema>;
export type BrowserTaskPayload = z.infer<typeof browserTaskPayloadSchema>;
export type BrowserResumePayload = z.infer<typeof browserResumePayloadSchema>;
export type NotificationDispatchPayload = z.infer<typeof notificationDispatchPayloadSchema>;
export type TelegramUpdatePayload = z.infer<typeof telegramUpdatePayloadSchema>;
export type WhatsAppChannelUpdatePayload = z.infer<typeof whatsappChannelUpdatePayloadSchema>;

export const supportedWorkerTasks = [
  "agent-team-run",
  "document-parse",
  "agent-run-resume",
  "notification-dispatch",
  "telegram-central-update",
  "whatsapp-channel-update",
  "sandbox-create",
  "sandbox-execute",
  "sandbox-resume",
  "sandbox-reset",
  "sandbox-cleanup",
  "sandbox-artifact-cleanup",
  "sandbox-health-check",
  "browser-task-execute",
  "browser-task-resume",
  "browser-session-verify",
  "browser-artifact-cleanup",
  "site-connection-health-check",
  "oauth-token-refresh",
] as const;
export type SupportedWorkerTask = typeof supportedWorkerTasks[number];
