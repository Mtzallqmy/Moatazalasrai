"use client";

import { useCallback, useEffect, useState } from "react";

export function useConversationNavigation({ initialConversationId, initialAgentId, initialNewChat, initialArchived, availableConversationIds, availableAgentIds, onBeforeChange }: {
  initialConversationId?: string;
  initialAgentId?: string;
  initialNewChat?: boolean;
  initialArchived: boolean;
  availableConversationIds: string[];
  availableAgentIds: string[];
  onBeforeChange: () => void;
}) {
  const [conversationId, setConversationId] = useState(!initialNewChat && initialConversationId && availableConversationIds.includes(initialConversationId) ? initialConversationId : initialNewChat ? "" : availableConversationIds[0] ?? "");
  const [agentId, setAgentId] = useState(initialAgentId && availableAgentIds.includes(initialAgentId) ? initialAgentId : availableAgentIds[0] ?? "");
  const [archived, setArchived] = useState(initialArchived);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const updateUrl = useCallback((nextId: string | null, view: "active" | "archived", newChat = false) => {
    const params = new URLSearchParams(window.location.search);
    if (nextId) params.set("conversationId", nextId); else params.delete("conversationId");
    if (newChat) params.set("new", "true"); else params.delete("new");
    if (view === "archived") params.set("view", "archived"); else params.delete("view");
    window.history.pushState(null, "", `/dashboard/chat${params.size ? `?${params}` : ""}`);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      onBeforeChange();
      const params = new URLSearchParams(window.location.search);
      setConversationId(params.get("new") === "true" ? "" : params.get("conversationId") ?? "");
      setArchived(params.get("view") === "archived");
      setMobileListOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [onBeforeChange]);

  const select = useCallback((id: string) => {
    setMobileListOpen(false);
    if (id === conversationId) return;
    onBeforeChange();
    setConversationId(id);
    updateUrl(id, archived ? "archived" : "active");
  }, [archived, conversationId, onBeforeChange, updateUrl]);

  const startNew = useCallback(() => {
    onBeforeChange();
    setConversationId("");
    setArchived(false);
    setMobileListOpen(false);
    updateUrl(null, "active", true);
  }, [onBeforeChange, updateUrl]);

  const changeArchived = useCallback((next: boolean) => {
    onBeforeChange();
    setArchived(next);
    setConversationId("");
    setMobileListOpen(true);
    updateUrl(null, next ? "archived" : "active");
  }, [onBeforeChange, updateUrl]);

  const commitCreated = useCallback((id: string) => {
    setConversationId(id);
    setArchived(false);
    setMobileListOpen(false);
    updateUrl(id, "active");
  }, [updateUrl]);

  return { conversationId, setConversationId, agentId, setAgentId, archived, mobileListOpen, setMobileListOpen, select, startNew, changeArchived, commitCreated };
}
