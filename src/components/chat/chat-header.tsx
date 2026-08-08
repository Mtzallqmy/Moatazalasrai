"use client";

import { memo } from "react";
import { ArrowRight, Palette, Users } from "lucide-react";
import type { Agent, Conversation } from "./types";

export const ChatHeader = memo(function ChatHeader({ conversation, agents, selectedAgentId, onOpenSidebar, onOpenMembers, onOpenAppearance }: {
  conversation?: Conversation;
  agents: Agent[];
  selectedAgentId: string;
  onOpenSidebar: () => void;
  onOpenMembers: () => void;
  onOpenAppearance: () => void;
}) {
  const agentName = conversation?.agentName ?? agents.find((agent) => agent.id === selectedAgentId)?.name ?? "يلزم نشر وكيل للبدء";
  return (
    <header className="conversation-header">
      <div className="conversation-header-title">
        <button type="button" className="icon-button chat-mobile-list-button" onClick={onOpenSidebar} aria-label="العودة إلى المحادثات"><ArrowRight size={19} /></button>
        <span className="conversation-agent-avatar" aria-hidden="true">{conversation?.agentName?.slice(0, 1) ?? "AI"}</span>
        <div className="min-w-0"><h2>{conversation?.title?.trim() || "محادثة جديدة"}</h2><p>{agentName}</p></div>
      </div>
      <div className="conversation-header-actions">
        <button type="button" className="icon-button" disabled={!conversation} onClick={onOpenMembers} aria-label="أعضاء المحادثة"><Users size={18} /></button>
        <button type="button" className="icon-button" onClick={onOpenAppearance} aria-label="مظهر المحادثة"><Palette size={18} /></button>
      </div>
    </header>
  );
});
