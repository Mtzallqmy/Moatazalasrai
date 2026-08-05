// Shared channel contracts keep Telegram, WhatsApp, and future adapters on one routing model.
export type ChannelKind = "telegram" | "whatsapp";

export type ChannelContentKind = "text" | "image" | "file" | "audio" | "interactive";

export type ChannelAttachment = {
  externalId: string;
  kind: Exclude<ChannelContentKind, "text" | "interactive">;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type ChannelInteractiveAction = {
  id: string;
  title?: string;
  payload?: Record<string, unknown>;
};

export type ChannelIdentity = {
  channel: ChannelKind;
  connectionId: string;
  externalConversationId: string;
  externalUserId: string;
  displayName?: string;
  username?: string;
  internalUserId?: string;
  organizationId: string;
};

export type IncomingChannelMessage = {
  id: string;
  identity: ChannelIdentity;
  text: string;
  replyToMessageId?: string;
  attachments: ChannelAttachment[];
  interactiveAction?: ChannelInteractiveAction;
  receivedAt: Date;
  rawMetadata?: Record<string, unknown>;
};

export type OutgoingChannelMessage = {
  text: string;
  replyToMessageId?: string;
  attachments?: ChannelAttachment[];
  actions?: ChannelInteractiveAction[];
  markReadMessageId?: string;
};

export type ChannelPermission =
  | "ai.chat"
  | "agent.use"
  | "tool.execute"
  | "account.read"
  | "conversation.open"
  | "ticket.create"
  | "order.track"
  | "files.use"
  | "search.use"
  | "workflow.execute"
  | "human.handoff";

export type ChannelRoutingPolicy = {
  agentId?: string;
  providerCredentialId?: string;
  model?: string;
  teamId?: string;
  inboxId?: string;
  workflowId?: string;
  allowedToolIds: string[];
  allowedCommands: string[];
  permissions: ChannelPermission[];
  mode: "ai_only" | "human_only" | "ai_then_human" | "human_then_ai" | "rules";
};

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  verifyWebhook(request: Request): Promise<void>;
  parseIncoming(request: Request): Promise<IncomingChannelMessage[]>;
  send(identity: ChannelIdentity, message: OutgoingChannelMessage): Promise<{ externalMessageId?: string }>;
  markRead?(identity: ChannelIdentity, externalMessageId: string): Promise<void>;
  downloadAttachment?(identity: ChannelIdentity, attachment: ChannelAttachment): Promise<Buffer>;
}
