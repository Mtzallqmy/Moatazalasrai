// Shared contracts used by every external messaging channel adapter and router.
import type { ChannelConnectionSettings, ChannelPermissionName } from "@/db/channel-schema";

export type ChannelKind = "telegram" | "whatsapp";
export type ChannelMediaKind = "image" | "file" | "audio" | "video";

export type ChannelIncomingAttachment = {
  externalId: string;
  kind: ChannelMediaKind;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type ChannelIncomingMessage = {
  eventId: string;
  externalAccountId: string;
  conversationExternalId: string;
  senderExternalId: string;
  senderDisplayName?: string;
  text: string;
  messageType: "text" | "interactive" | "media" | "unknown";
  interactiveActionId?: string;
  replyToExternalId?: string;
  locale?: string;
  attachments: ChannelIncomingAttachment[];
  receivedAt: Date;
};

export type ChannelOutgoingAction = {
  id: string;
  title: string;
  description?: string;
};

export type ChannelOutgoingMessage = {
  to: string;
  text: string;
  replyToExternalId?: string;
  buttons?: ChannelOutgoingAction[];
  list?: {
    title: string;
    buttonText: string;
    actions: ChannelOutgoingAction[];
  };
};

export type ChannelDeliveryCredentials =
  | { kind: "telegram"; token: string }
  | {
      kind: "whatsapp";
      accessToken: string;
      phoneNumberId: string;
      graphApiVersion: string;
    };

export type ChannelAdapterContext = {
  organizationId: string;
  connectionId: string;
  externalAccountId: string;
  credentials: ChannelDeliveryCredentials;
};

export type ChannelHealth = {
  status: "healthy" | "degraded" | "failed";
  checkedAt: string;
  latencyMs: number;
  details: string;
  errorCode?: string;
};

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  readonly capabilities: ReadonlySet<
    "text" | "images" | "files" | "audio" | "video" | "interactive" | "read_receipts" | "reply"
  >;
  normalizeIncoming(
    payload: unknown,
    hints?: { externalAccountId?: string },
  ): ChannelIncomingMessage[];
  send(context: ChannelAdapterContext, message: ChannelOutgoingMessage): Promise<{ externalMessageId: string }>;
  markRead?(context: ChannelAdapterContext, externalMessageId: string): Promise<void>;
  downloadAttachment?(
    context: ChannelAdapterContext,
    attachment: ChannelIncomingAttachment,
  ): Promise<{ content: Buffer; filename: string; mimeType: string }>;
  test(context: ChannelAdapterContext): Promise<ChannelHealth>;
}

export type ChannelRoutingPolicy = {
  settings: ChannelConnectionSettings;
  permissions: ReadonlySet<ChannelPermissionName>;
  blockedOperations: ReadonlySet<string>;
  allowedCommands: ReadonlySet<string>;
  allowedToolIds: readonly string[];
};
