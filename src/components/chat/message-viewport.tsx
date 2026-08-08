"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Loader2, RefreshCw } from "lucide-react";
import type { ChatAppearance } from "@/lib/chat/appearance";
import { useAutoScroll } from "./hooks/use-auto-scroll";
import { MessageItem } from "./message-item";
import { MessageList } from "./message-list";
import type { ActionDialog, Agent, Conversation, Message } from "./types";

export const MessageViewport = memo(function MessageViewport({ conversationId, activeConversation, agents, selectedAgentId, onSelectAgent, completedMessages, activeStreamingMessage, appearance, loading, loadingOlder, hasOlder, error, onLoadOlder, onReload, currentUserId, onAction }: {
  conversationId: string;
  activeConversation?: Conversation;
  agents: Agent[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  completedMessages: Message[];
  activeStreamingMessage: Message | null;
  appearance: ChatAppearance;
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  error: string | null;
  onLoadOlder: () => Promise<number>;
  onReload: () => Promise<void>;
  currentUserId: string;
  onAction: (dialog: ActionDialog) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const contentSignal = `${completedMessages.length}:${activeStreamingMessage?.content.length ?? 0}:${activeStreamingMessage?.status ?? ""}`;
  const autoScroll = useAutoScroll(viewportRef, contentSignal);
  useEffect(() => () => {
    if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const copy = useCallback(async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
      setCopiedMessageId(message.id);
      copyTimeoutRef.current = window.setTimeout(() => setCopiedMessageId(null), 1_500);
    } catch {
      // Clipboard permission errors are intentionally non-fatal to the stream.
    }
  }, []);

  const loadOlder = useCallback(async () => {
    const viewport = viewportRef.current;
    const previousHeight = viewport?.scrollHeight ?? 0;
    const previousTop = viewport?.scrollTop ?? 0;
    const added = await onLoadOlder();
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    if (added > 0) scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (viewport) viewport.scrollTop = viewport.scrollHeight - previousHeight + previousTop;
    });
  }, [onLoadOlder]);

  const agentName = activeConversation?.agentName ?? "الوكيل";
  return (
    <>
      <div ref={viewportRef} className={`chat-stage chat-theme-${appearance.theme} chat-wallpaper-${appearance.wallpaper}`} aria-live="polite" onScroll={autoScroll.onScroll}>
        {hasOlder ? <div className="older-messages"><button type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} رسائل أقدم</button></div> : null}
        {error ? <div className="message-error" role="alert"><p>{error}</p>{conversationId ? <button type="button" className="secondary-button" onClick={() => void onReload()}>إعادة المحاولة</button> : null}</div> : null}
        {loading ? <div className="message-skeleton-stack">{[0, 1, 2].map((item) => <div key={item} className="skeleton message-skeleton" />)}</div> : null}
        {!loading && !error && conversationId && completedMessages.length === 0 && !activeStreamingMessage ? <div className="message-empty"><span>✦</span><h3>ابدأ المحادثة</h3><p>اكتب رسالتك، ويمكنك إضافة ملفات أو سياق متقدم عند الحاجة.</p></div> : null}
        {!conversationId ? <div className="message-empty new-chat-empty"><span>✦</span><h3>ابدأ مع وكيلك الذكي</h3><p>{agents.length ? "اختر الوكيل ثم اكتب رسالتك. سننشئ المحادثة تلقائيًا عند الإرسال." : "لا يوجد وكيل منشور. أنشئ وكيلًا واربطه بمزوّد متحقق أولًا."}</p>{agents.length ? <label><span>الوكيل</span><select className="form-control" value={selectedAgentId} onChange={(event) => onSelectAgent(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label> : <a className="primary-button" href="/dashboard/agents">إعداد وكيل ذكي</a>}</div> : null}
        <MessageList messages={completedMessages} viewportRef={viewportRef} agentName={agentName} currentUserId={currentUserId} canManage={activeConversation?.canManage === true} copiedMessageId={copiedMessageId} onCopy={copy} onAction={onAction} />
        {activeStreamingMessage ? <div className="active-streaming-message"><MessageItem message={activeStreamingMessage} agentName={agentName} currentUserId={currentUserId} canManage={false} copied={false} onCopy={copy} onAction={onAction} /></div> : null}
        <div className="chat-scroll-anchor" />
      </div>
      {autoScroll.showLatest ? <button type="button" className="latest-message-button" onClick={autoScroll.scrollToLatest}><ArrowDown size={16} /> أحدث رسالة</button> : null}
    </>
  );
});
