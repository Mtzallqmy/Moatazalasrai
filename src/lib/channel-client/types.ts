import type { ChannelConnectionRow } from "@/lib/channels/connections";
import type { ChannelIncomingMessage } from "@/lib/channels/types";
import type { ChannelClientKind, ChannelClientSession } from "./session-service";

export type ChannelClientAction = {
  id: string;
  title: string;
  url?: string;
};

export type ChannelClientView = {
  text: string;
  actions?: ChannelClientAction[][];
  path?: string[];
  editCurrent?: boolean;
};

export type ChannelClientTransport = {
  send(view: ChannelClientView): Promise<void>;
  answerCallback?(text?: string): Promise<void>;
  sendTyping?(): Promise<void>;
};

export type ChannelClientIdentity = {
  channel: ChannelClientKind;
  userId: string;
  organizationId: string;
  externalUserId: string;
  externalChatId: string;
  displayName?: string | null;
};

export type ChannelClientRuntimeInput = {
  identity: ChannelClientIdentity;
  session: ChannelClientSession;
  connection: ChannelConnectionRow;
  incoming: ChannelIncomingMessage;
  text: string;
  actionId?: string | null;
  transport: ChannelClientTransport;
  featureAllowed(featureKey: string): Promise<boolean>;
};

export type ChannelClientRuntimeResult = {
  handled: boolean;
  session: ChannelClientSession;
  conversationId?: string;
  runId?: string;
};
