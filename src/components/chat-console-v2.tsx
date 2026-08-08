"use client";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import type { ChatWorkspaceProps } from "@/components/chat/types";

/** Compatibility entry point for the dashboard route. The implementation is split by render and connection ownership under components/chat. */
export function ChatConsoleV2(props: ChatWorkspaceProps) {
  return <ChatWorkspace {...props} />;
}
