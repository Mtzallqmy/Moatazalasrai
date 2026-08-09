"use client";

import { memo, useCallback, type RefObject } from "react";
import { MessageItem } from "./message-item";
import { useVirtualMessageWindow } from "./hooks/use-virtual-message-window";
import type { ActionDialog, Message } from "./types";

const VirtualMessageRow = memo(function VirtualMessageRow({ message, register, agentName, currentUserId, canManage, copied, showTechnicalDetails, onCopy, onAction }: {
  message: Message;
  register: (id: string, node: HTMLElement | null) => void;
  agentName: string;
  currentUserId: string;
  canManage: boolean;
  copied: boolean;
  showTechnicalDetails: boolean;
  onCopy: (message: Message) => void;
  onAction: (dialog: ActionDialog) => void;
}) {
  const rowRef = useCallback((node: HTMLDivElement | null) => register(message.id, node), [message.id, register]);
  return <div ref={rowRef} className="virtual-message-row"><MessageItem message={message} agentName={agentName} currentUserId={currentUserId} canManage={canManage} copied={copied} showTechnicalDetails={showTechnicalDetails} onCopy={onCopy} onAction={onAction} /></div>;
});

export const MessageList = memo(function MessageList({ messages, viewportRef, agentName, currentUserId, canManage, copiedMessageId, showTechnicalDetails, onCopy, onAction }: {
  messages: Message[];
  viewportRef: RefObject<HTMLDivElement | null>;
  agentName: string;
  currentUserId: string;
  canManage: boolean;
  copiedMessageId: string | null;
  showTechnicalDetails: boolean;
  onCopy: (message: Message) => void;
  onAction: (dialog: ActionDialog) => void;
}) {
  const windowed = useVirtualMessageWindow(messages, viewportRef);
  return (
    <div className="message-list" data-virtualized={windowed.virtualized ? "true" : "false"} data-rendered-count={windowed.renderedCount}>
      {windowed.topSpacer ? <div aria-hidden="true" style={{ height: windowed.topSpacer }} /> : null}
      {windowed.visibleMessages.map((message) => <VirtualMessageRow key={message.id} message={message} register={windowed.register} agentName={agentName} currentUserId={currentUserId} canManage={canManage} copied={copiedMessageId === message.id} showTechnicalDetails={showTechnicalDetails} onCopy={onCopy} onAction={onAction} />)}
      {windowed.bottomSpacer ? <div aria-hidden="true" style={{ height: windowed.bottomSpacer }} /> : null}
    </div>
  );
});
