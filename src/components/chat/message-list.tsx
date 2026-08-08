"use client";

import { memo, type RefObject } from "react";
import { MessageItem } from "./message-item";
import { useVirtualMessageWindow } from "./hooks/use-virtual-message-window";
import type { ActionDialog, Message } from "./types";

export const MessageList = memo(function MessageList({ messages, viewportRef, agentName, currentUserId, canManage, copiedMessageId, onCopy, onAction }: {
  messages: Message[];
  viewportRef: RefObject<HTMLDivElement | null>;
  agentName: string;
  currentUserId: string;
  canManage: boolean;
  copiedMessageId: string | null;
  onCopy: (message: Message) => void;
  onAction: (dialog: ActionDialog) => void;
}) {
  const windowed = useVirtualMessageWindow(messages, viewportRef);
  return (
    <div className="message-list" data-virtualized={windowed.virtualized ? "true" : "false"} data-rendered-count={windowed.renderedCount}>
      {windowed.topSpacer ? <div aria-hidden="true" style={{ height: windowed.topSpacer }} /> : null}
      {windowed.visibleMessages.map((message) => (
        <div key={message.id} ref={(node) => windowed.register(message.id, node)} className="virtual-message-row">
          <MessageItem message={message} agentName={agentName} currentUserId={currentUserId} canManage={canManage} copied={copiedMessageId === message.id} onCopy={onCopy} onAction={onAction} />
        </div>
      ))}
      {windowed.bottomSpacer ? <div aria-hidden="true" style={{ height: windowed.bottomSpacer }} /> : null}
    </div>
  );
});
