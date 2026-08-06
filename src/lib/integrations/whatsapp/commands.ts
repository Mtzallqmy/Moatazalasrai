import type { WhatsAppIncomingMessage } from "./webhook";
import { parseWhatsAppUpdate } from "@/lib/whatsapp/update-parser";

/**
 * Compatibility IDs for older clients and tests. Runtime execution lives in
 * src/lib/whatsapp/update-processor.ts; this module does not perform business work.
 */
export const WHATSAPP_COMMAND_IDS = Object.freeze({
  account: "wa.account",
  openChat: "wa.chat",
  status: "wa.status",
  disconnect: "wa.disconnect",
  menu: "wa.menu",
});

type ParsedCommand =
  | { kind: "connect"; token: string }
  | { kind: "account" | "open_chat" | "status" | "disconnect" | "menu" | "unknown" };

export function parseWhatsAppCommand(message: WhatsAppIncomingMessage): ParsedCommand {
  const parsed = parseWhatsAppUpdate(message);
  if (parsed.kind === "connect") return parsed;
  if (parsed.kind !== "action") return { kind: "unknown" };
  switch (parsed.actionId) {
    case "wa.account":
      return { kind: "account" };
    case "wa.chat":
      return { kind: "open_chat" };
    case "wa.status":
      return { kind: "status" };
    case "wa.disconnect":
      return { kind: "disconnect" };
    case "wa.menu":
      return { kind: "menu" };
    default:
      return { kind: "unknown" };
  }
}
