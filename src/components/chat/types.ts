import type { ChatAppearance } from "@/lib/chat/appearance";

export type Agent = { id: string; name: string };
export type KnowledgeBaseOption = { id: string; name: string };

export type Conversation = {
  id: string;
  title: string | null;
  agentId: string;
  agentName: string;
  summary?: string | null;
  status?: string;
  pinnedAt?: string | null;
  archivedAt?: string | null;
  lastMessageAt?: string | null;
  providerCredentialId?: string | null;
  model?: string | null;
  createdAt?: string;
  updatedAt: string;
  canWrite?: boolean;
  canManage?: boolean;
};

export type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus?: string;
  intelligenceStatus?: string;
  chunkCount?: number;
  warnings?: string[];
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  authorUserId?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
  content: string;
  status?: "sending" | "streaming" | "completed" | "failed" | "interrupted" | "cancelled";
  createdAt: string;
  completedAt?: string | null;
  requestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  model?: string | null;
  editedAt?: string | null;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
};

export type ModelOption = {
  providerCredentialId: string;
  providerName: string;
  provider: string;
  model: string;
  freeTierEligible: boolean;
  available: boolean;
  latencyMs?: number | null;
  capabilities?: { text?: boolean; vision?: boolean; files?: boolean; tools?: boolean; structuredOutput?: boolean; streaming?: boolean };
};

export type UploadState = "SELECTED" | "VALIDATING" | "UPLOADING" | "PROCESSING" | "READY" | "PARTIALLY_READY" | "FAILED" | "CANCELLED";
export type UploadTask = {
  id: string;
  file: File;
  state: UploadState;
  progress: number | null;
  message?: string | null;
  attachment?: Attachment | null;
};

export type SendOptions = {
  text: string;
  attachments: Attachment[];
  providerCredentialId?: string;
  model?: string;
  knowledgeBaseId?: string;
  useMemory: boolean;
};

export type ComposerSendOptions = SendOptions & {
  executionMode: "server" | "puter";
  puterModel?: string;
};

export type ChatWorkspaceProps = {
  agents: Agent[];
  initialConversations: Conversation[];
  initialConversationId?: string;
  initialAgentId?: string;
  initialNewChat?: boolean;
  currentUser: { id: string; name: string; email: string };
  initialAppearance: ChatAppearance;
  puterEnabled: boolean;
  knowledgeBases?: KnowledgeBaseOption[];
  ragEnabled: boolean;
  memoryEnabled: boolean;
};

export type ActionDialog =
  | { kind: "rename-conversation"; row: Conversation; value: string }
  | { kind: "delete-conversation"; row: Conversation }
  | { kind: "edit-message"; message: Message; value: string }
  | { kind: "delete-message"; message: Message };
