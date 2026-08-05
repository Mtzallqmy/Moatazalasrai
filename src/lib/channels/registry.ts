// Central registry keeps channel-specific transport details out of routing logic.
import { telegramChannelAdapter } from "./telegram-adapter";
import { whatsappChannelAdapter } from "./whatsapp-adapter";
import type { ChannelAdapter, ChannelKind } from "./types";

const adapters = new Map<ChannelKind, ChannelAdapter>([
  [telegramChannelAdapter.kind, telegramChannelAdapter],
  [whatsappChannelAdapter.kind, whatsappChannelAdapter],
]);

export function channelAdapter(kind: ChannelKind) {
  const adapter = adapters.get(kind);
  if (!adapter) throw new Error(`Unknown channel adapter: ${kind}`);
  return adapter;
}

export function listChannelAdapters() {
  return [...adapters.values()].map((adapter) => ({
    kind: adapter.kind,
    capabilities: [...adapter.capabilities],
  }));
}
