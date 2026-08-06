import { ApiError } from "@/lib/http/api";
import type { ChannelClientAction, ChannelClientTransport, ChannelClientView } from "./types";

const MAX_TEXT = 12_000;
const MAX_CALLBACK_BYTES = 64;

function nonEmpty(value: unknown, fallback?: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text) return text;
  if (fallback?.trim()) return fallback.trim();
  throw new ApiError(500, "CHANNEL_EMPTY_MESSAGE", "تعذر إنشاء محتوى صالح للرسالة.");
}

function safeAction(action: ChannelClientAction): ChannelClientAction {
  const title = nonEmpty(action.title).slice(0, 64);
  if (action.url) return { title, url: action.url };
  const id = nonEmpty(action.id);
  if (Buffer.byteLength(id, "utf8") > MAX_CALLBACK_BYTES) {
    throw new ApiError(500, "CHANNEL_CALLBACK_TOO_LONG", "معرّف الإجراء أطول من الحد المسموح.");
  }
  return { title, id };
}

export function normalizeChannelClientView(view: ChannelClientView): ChannelClientView {
  const path = view.path?.map((item) => item.trim()).filter(Boolean).slice(0, 6) ?? [];
  const body = nonEmpty(view.text);
  const heading = path.length ? `${path.join(" ← ")}\n\n` : "";
  const text = `${heading}${body}`.slice(0, MAX_TEXT);
  const actions = view.actions
    ?.slice(0, 12)
    .map((row) => row.slice(0, 4).map(safeAction))
    .filter((row) => row.length > 0);
  return { ...view, text, path: undefined, actions };
}

export async function sendChannelClientView(transport: ChannelClientTransport, view: ChannelClientView) {
  await transport.send(normalizeChannelClientView(view));
}

export function channelEmptyState(input: {
  title: string;
  reason: string;
  action?: ChannelClientAction;
  path?: string[];
}): ChannelClientView {
  return {
    path: input.path,
    text: `${nonEmpty(input.title)}\n${nonEmpty(input.reason)}`,
    actions: input.action ? [[safeAction(input.action)]] : undefined,
  };
}
