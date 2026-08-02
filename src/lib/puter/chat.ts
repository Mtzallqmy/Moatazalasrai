"use client";

import type { ChatMessage } from "@heyputer/puter.js";
import type { PuterChatChunk, PuterChatMessage, PuterClient } from "@/lib/puter/types";

type StreamInput = {
  client: PuterClient;
  messages: PuterChatMessage[];
  model: string;
  signal?: AbortSignal;
  onText: (delta: string) => void;
};

function chunkMessage(chunk: PuterChatChunk): string | null {
  if (chunk.type !== "error") return null;
  const value = chunk as PuterChatChunk & { message?: unknown; error?: unknown };
  if (typeof value.message === "string") return value.message;
  if (typeof value.error === "string") return value.error;
  return "تعذر إكمال الطلب عبر Puter.";
}

export async function streamPuterChat(input: StreamInput): Promise<string> {
  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const wireMessages: ChatMessage[] = input.messages.map((message) => ({
    role: message.role,
    content: message.content,
    images: [],
  }));
  const response = await input.client.ai.chat(wireMessages, { model: input.model, stream: true });
  if (!response || typeof response !== "object" || !(Symbol.asyncIterator in response)) {
    throw new Error("لم يبدأ Puter بث الاستجابة.");
  }
  const iterator = (response as AsyncIterable<PuterChatChunk>)[Symbol.asyncIterator]();
  let text = "";
  try {
    while (true) {
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const next = await iterator.next();
      if (next.done) break;
      const error = chunkMessage(next.value);
      if (error) throw new Error(error);
      if (next.value.type === "text" && typeof next.value.text === "string" && next.value.text) {
        text += next.value.text;
        input.onText(next.value.text);
      }
    }
    if (!text.trim()) throw new Error("لم يُرجع Puter نصًا قابلًا للعرض.");
    return text;
  } finally {
    // Puter لا يوثق AbortSignal حاليًا؛ عند الإلغاء نوقف تحديث الواجهة ونحاول إغلاق iterator.
    if (input.signal?.aborted && iterator.return) await iterator.return().catch(() => undefined);
  }
}
