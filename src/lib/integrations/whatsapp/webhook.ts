export type WhatsAppIncomingMessage = {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};

export type ExtractedWhatsAppMessage = {
  message: WhatsAppIncomingMessage;
  phoneNumberId?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractWhatsAppMessages(payload: unknown): ExtractedWhatsAppMessage[] {
  const root = record(payload);
  if (!root || !Array.isArray(root.entry)) return [];
  const output: ExtractedWhatsAppMessage[] = [];
  for (const entryValue of root.entry) {
    const entry = record(entryValue);
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const changeValue of entry.changes) {
      const change = record(changeValue);
      const value = record(change?.value);
      if (!value || !Array.isArray(value.messages)) continue;
      const metadata = record(value.metadata);
      const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : undefined;
      for (const messageValue of value.messages) {
        const message = record(messageValue);
        if (!message || typeof message.id !== "string" || typeof message.from !== "string" || typeof message.type !== "string") continue;
        output.push({ message: message as WhatsAppIncomingMessage, ...(phoneNumberId ? { phoneNumberId } : {}) });
      }
    }
  }
  return output;
}
