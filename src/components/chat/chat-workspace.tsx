"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ChatAppearance, ChatThemeId, ChatWallpaperId } from "@/lib/chat/appearance";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import { ChatComposer } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ConversationSidebar } from "./conversation-sidebar";
import { useChatStream, type StreamCallbacks } from "./hooks/use-chat-stream";
import { useConversationMessages } from "./hooks/use-conversation-messages";
import { useConversationNavigation } from "./hooks/use-conversation-navigation";
import { usePuterStream } from "./hooks/use-puter-stream";
import { MessageViewport } from "./message-viewport";
import type { ActionDialog, ChatWorkspaceProps, ComposerSendOptions, Conversation, Message } from "./types";

const ChatOverlays = dynamic(() => import("./chat-overlays"), { ssr: false });

export function ChatWorkspace(props: ChatWorkspaceProps) {
  const { agents, initialConversations, initialConversationId, initialAgentId, initialNewChat, currentUser, initialAppearance, puterEnabled, ragEnabled, memoryEnabled } = props;
  const [conversations, setConversations] = useState(initialConversations);
  const [skipLoadForId, setSkipLoadForId] = useState<string | undefined>();
  const [appearance, setAppearance] = useState<ChatAppearance>(initialAppearance);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const cancelWorkRef = useRef<() => void>(() => undefined);
  const createControllerRef = useRef<AbortController | null>(null);
  const createPromiseRef = useRef<Promise<Conversation | null> | null>(null);
  const cancelBeforeNavigation = useCallback(() => {
    createControllerRef.current?.abort();
    createControllerRef.current = null;
    createPromiseRef.current = null;
    cancelWorkRef.current();
  }, []);
  const navigation = useConversationNavigation({
    initialConversationId,
    initialAgentId,
    initialNewChat,
    initialArchived: false,
    availableConversationIds: initialConversations.map((item) => item.id),
    availableAgentIds: agents.map((item) => item.id),
    onBeforeChange: cancelBeforeNavigation,
  });
  const { conversationId, agentId, archived, mobileListOpen, setMobileListOpen, setAgentId, select, startNew: navigateNew, changeArchived, commitCreated } = navigation;
  const messages = useConversationMessages(conversationId, skipLoadForId);
  const { completedMessages, loading: messagesLoading, loadingOlder, hasOlder, error: messagesError, setError: setMessageError, loadOlder, reload, append, replace, patch: patchMessage, remove: removeMessage, reset: resetMessages } = messages;
  const activeConversation = conversations.find((item) => item.id === conversationId);

  const streamCallbacks = useMemo<StreamCallbacks>(() => ({
    onOptimisticUser: append,
    onServerUser: replace,
    onAssistantComplete: append,
    onUserFailed: (id, status) => patchMessage(id, { status }),
    onRefreshRequired: reload,
  }), [append, patchMessage, reload, replace]);
  const serverStream = useChatStream(conversationId, currentUser, streamCallbacks);
  const puterStream = usePuterStream(conversationId, currentUser, streamCallbacks);
  const { activeStreamingMessage: serverMessage, status: serverStatus, error: serverError, retryText, generating: serverGenerating, send: sendServer, stop: stopServer, cancel: cancelServer } = serverStream;
  const { activeStreamingMessage: puterMessage, status: puterStatus, error: puterError, generating: puterGenerating, send: sendPuter, stop: stopPuter, cancel: cancelPuter } = puterStream;
  const generating = serverGenerating || puterGenerating;
  const activeStreamingMessage = serverMessage ?? puterMessage;
  useEffect(() => {
    cancelWorkRef.current = () => {
      cancelServer();
      cancelPuter();
      resetMessages();
    };
    return () => { cancelWorkRef.current = () => undefined; };
  }, [cancelPuter, cancelServer, resetMessages]);

  const selectConversation = useCallback((row: Conversation) => {
    setSkipLoadForId(undefined);
    setConversations((current) => current.some((item) => item.id === row.id) ? current : [row, ...current]);
    setMembersOpen(false);
    select(row.id);
  }, [select]);

  const startNew = useCallback(() => {
    setSkipLoadForId(undefined);
    setMembersOpen(false);
    navigateNew();
  }, [navigateNew]);

  const ensureConversation = useCallback(async () => {
    if (conversationId) return activeConversation ?? null;
    if (!agentId) return null;
    if (createPromiseRef.current) return createPromiseRef.current;
    const controller = new AbortController();
    createControllerRef.current = controller;
    const promise = apiRequest<Conversation>("/api/dashboard/chat", { method: "POST", signal: controller.signal, body: { action: "create", agentId } })
      .then((created) => {
        if (controller.signal.aborted) return null;
        const row: Conversation = { ...created, agentName: agents.find((agent) => agent.id === agentId)?.name ?? "وكيل", status: "active", pinnedAt: null, archivedAt: null, lastMessageAt: null, canWrite: true, canManage: true, updatedAt: new Date(created.updatedAt).toISOString() };
        setConversations((current) => [row, ...current]);
        setSkipLoadForId(row.id);
        commitCreated(row.id);
        return row;
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setConversationError(apiErrorMessage(cause, "تعذر إنشاء المحادثة."));
        return null;
      })
      .finally(() => {
        if (createControllerRef.current === controller) {
          createControllerRef.current = null;
          createPromiseRef.current = null;
        }
      });
    createPromiseRef.current = promise;
    return promise;
  }, [activeConversation, agentId, agents, commitCreated, conversationId]);

  const send = useCallback(async (options: ComposerSendOptions) => {
    const conversation = await ensureConversation();
    if (!conversation || conversation.canWrite === false) return false;
    if (options.executionMode === "puter") return sendPuter(conversation.id, options.text, options.puterModel ?? "");
    return sendServer(conversation.id, options);
  }, [ensureConversation, sendPuter, sendServer]);

  const stop = useCallback(async () => {
    if (puterGenerating) await stopPuter(); else await stopServer();
  }, [puterGenerating, stopPuter, stopServer]);

  const action = useCallback((body: Record<string, unknown>) => apiRequest<Conversation & { deleted?: boolean }>("/api/dashboard/chat", { method: "POST", body }), []);
  const pin = useCallback(async (row: Conversation) => {
    try {
      const updated = await action({ action: "pin", conversationId: row.id, pinned: !row.pinnedAt });
      setConversations((current) => current.map((item) => item.id === row.id ? { ...item, pinnedAt: updated.pinnedAt ? new Date(updated.pinnedAt).toISOString() : null, updatedAt: new Date(updated.updatedAt).toISOString() } : item));
    } catch (cause) { setConversationError(apiErrorMessage(cause, "تعذر تحديث التثبيت.")); }
  }, [action]);
  const archive = useCallback(async (row: Conversation) => {
    try {
      await action({ action: "archive", conversationId: row.id, archived: true });
      setConversations((current) => current.filter((item) => item.id !== row.id));
      if (conversationId === row.id) startNew();
    } catch (cause) { setConversationError(apiErrorMessage(cause, "تعذر أرشفة المحادثة.")); }
  }, [action, conversationId, startNew]);
  const restore = useCallback(async (row: Conversation) => {
    try {
      await action({ action: "archive", conversationId: row.id, archived: false });
      if (conversationId === row.id) changeArchived(true);
    } catch (cause) { setConversationError(apiErrorMessage(cause, "تعذر استعادة المحادثة.")); }
  }, [action, changeArchived, conversationId]);

  const mutateMessage = useCallback(async (message: Message, actionName: "edit" | "delete", nextContent?: string) => {
    const content = actionName === "edit" ? nextContent?.trim() : undefined;
    if (actionName === "edit" && !content) return false;
    try {
      await apiRequest<Message>("/api/dashboard/messages", { method: "PATCH", body: { action: actionName, messageId: message.id, ...(content ? { content } : {}) } });
      if (actionName === "delete") removeMessage(message.id);
      else {
        patchMessage(message.id, { content, editedAt: new Date().toISOString() });
        await send({ text: content!, attachments: [], executionMode: "server", useMemory: false });
      }
      return true;
    } catch (cause) {
      setMessageError(apiErrorMessage(cause, "تعذر تحديث الرسالة."));
      return false;
    }
  }, [patchMessage, removeMessage, send, setMessageError]);

  const removeConversation = useCallback(async (row: Conversation) => {
    try {
      await action({ action: "delete", conversationId: row.id });
      setConversations((current) => current.filter((item) => item.id !== row.id));
      if (conversationId === row.id) startNew();
      return true;
    } catch (cause) { setConversationError(apiErrorMessage(cause, "تعذر حذف المحادثة.")); return false; }
  }, [action, conversationId, startNew]);

  const submitAction = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!actionDialog || dialogBusy) return;
    setDialogBusy(true);
    try {
      let succeeded = false;
      if (actionDialog.kind === "rename-conversation") {
        const title = actionDialog.value.trim();
        if (title) {
          const updated = await action({ action: "rename", conversationId: actionDialog.row.id, title });
          setConversations((current) => current.map((item) => item.id === actionDialog.row.id ? { ...item, title: updated.title } : item));
          succeeded = true;
        }
      }
      if (actionDialog.kind === "delete-conversation") succeeded = await removeConversation(actionDialog.row);
      if (actionDialog.kind === "edit-message") succeeded = await mutateMessage(actionDialog.message, "edit", actionDialog.value);
      if (actionDialog.kind === "delete-message") succeeded = await mutateMessage(actionDialog.message, "delete");
      if (succeeded) setActionDialog(null);
    } catch (cause) {
      setConversationError(apiErrorMessage(cause, "تعذر تنفيذ الإجراء."));
    } finally { setDialogBusy(false); }
  }, [action, actionDialog, dialogBusy, mutateMessage, removeConversation]);

  const saveAppearance = useCallback(async (kind: "theme" | "wallpaper", value: ChatThemeId | ChatWallpaperId) => {
    const previous = appearance;
    const next = kind === "theme" ? { ...appearance, theme: value as ChatThemeId } : { ...appearance, wallpaper: value as ChatWallpaperId };
    setAppearance(next);
    setSavingAppearance(true);
    try { setAppearance(await apiRequest<ChatAppearance>("/api/dashboard/chat/preferences", { method: "PUT", body: next })); }
    catch (cause) { setAppearance(previous); setConversationError(apiErrorMessage(cause, "تعذر حفظ مظهر المحادثة.")); }
    finally { setSavingAppearance(false); }
  }, [appearance]);

  const openSidebar = useCallback(() => setMobileListOpen(true), [setMobileListOpen]);
  const closeSidebar = useCallback(() => setMobileListOpen(false), [setMobileListOpen]);
  const openMembers = useCallback(() => setMembersOpen(true), []);
  const closeMembers = useCallback(() => setMembersOpen(false), []);
  const openAppearance = useCallback(() => setAppearanceOpen(true), []);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
  const handlePin = useCallback((row: Conversation) => { void pin(row); }, [pin]);
  const handleArchive = useCallback((row: Conversation) => { void archive(row); }, [archive]);
  const handleRestore = useCallback((row: Conversation) => { void restore(row); }, [restore]);
  const handleAppearance = useCallback((kind: "theme" | "wallpaper", value: ChatThemeId | ChatWallpaperId) => { void saveAppearance(kind, value); }, [saveAppearance]);
  const handleSubmitAction = useCallback((event: FormEvent<HTMLFormElement>) => { void submitAction(event); }, [submitAction]);
  const streamStatus = serverStatus ?? puterStatus;
  const streamError = serverError ?? puterError ?? conversationError;

  return (
    <div className="conversation-workspace" data-mobile-list-open={mobileListOpen ? "true" : "false"} data-component="chat-workspace">
      <ConversationSidebar conversations={conversations} activeId={conversationId} agents={agents} selectedAgentId={agentId} archived={archived} mobileOpen={mobileListOpen} busy={generating} onSelectAgent={setAgentId} onSelect={selectConversation} onNew={startNew} onArchivedChange={changeArchived} onAction={setActionDialog} onPin={handlePin} onArchive={handleArchive} onRestore={handleRestore} onCloseMobile={closeSidebar} />
      <section className="conversation-main">
        <ChatHeader conversation={activeConversation} agents={agents} selectedAgentId={agentId} onOpenSidebar={openSidebar} onOpenMembers={openMembers} onOpenAppearance={openAppearance} />
        <MessageViewport conversationId={conversationId} activeConversation={activeConversation} agents={agents} selectedAgentId={agentId} onSelectAgent={setAgentId} completedMessages={completedMessages} activeStreamingMessage={activeStreamingMessage} appearance={appearance} loading={messagesLoading} loadingOlder={loadingOlder} hasOlder={hasOlder} error={messagesError} onLoadOlder={loadOlder} onReload={reload} currentUserId={currentUser.id} onAction={setActionDialog} />
        <ChatComposer conversationId={conversationId} canWrite={activeConversation?.canWrite !== false} agentsAvailable={agents.length > 0} generating={generating} streamStatus={streamStatus} streamError={streamError} retryText={retryText} puterEnabled={puterEnabled} ragEnabled={ragEnabled} memoryEnabled={memoryEnabled} onSend={send} onStop={stop} />
      </section>
      {membersOpen || appearanceOpen || actionDialog ? <ChatOverlays conversationId={conversationId} membersOpen={membersOpen} appearanceOpen={appearanceOpen} actionDialog={actionDialog} dialogBusy={dialogBusy} savingAppearance={savingAppearance} appearance={appearance} onCloseMembers={closeMembers} onCloseAppearance={closeAppearance} onAppearance={handleAppearance} onActionDialog={setActionDialog} onSubmitAction={handleSubmitAction} /> : null}
    </div>
  );
}
