import type { ChatResponseChunk, Puter } from "@heyputer/puter.js";

export type PuterClient = Puter;

export type PuterChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PuterChatChunk = ChatResponseChunk;

export type ClientAIModel = {
  id: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: string[];
  cost: Record<string, number> | null;
};

export type PuterConnectionState =
  | "idle"
  | "loading-sdk"
  | "connecting"
  | "connected"
  | "loading-models"
  | "streaming"
  | "cancelled"
  | "error";
