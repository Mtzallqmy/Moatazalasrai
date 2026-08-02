import type { ReactNode } from "react";
import { Suspense } from "react";
import { SandboxConversationDock } from "@/components/sandbox-conversation-dock";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <>
    {children}
    <Suspense fallback={null}><SandboxConversationDock /></Suspense>
  </>;
}
