"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Archive, FilePlus2, Loader2, MoreHorizontal, Pencil, Pin, RotateCcw, Trash2, X } from "lucide-react";
import { groupConversations } from "@/lib/chat/conversation-groups";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import { relativeTime } from "@/lib/ui/presentation";
import type { ActionDialog, Agent, Conversation } from "./types";

const PAGE_SIZE = 50;

export const ConversationSidebar = memo(function ConversationSidebar({ conversations, activeId, agents, selectedAgentId, archived, mobileOpen, busy, onSelectAgent, onSelect, onNew, onArchivedChange, onAction, onPin, onArchive, onRestore, onCloseMobile }: {
  conversations: Conversation[];
  activeId: string;
  agents: Agent[];
  selectedAgentId: string;
  archived: boolean;
  mobileOpen: boolean;
  busy: boolean;
  onSelectAgent: (id: string) => void;
  onSelect: (conversation: Conversation) => void;
  onNew: () => void;
  onArchivedChange: (archived: boolean) => void;
  onAction: (dialog: ActionDialog) => void;
  onPin: (conversation: Conversation) => void;
  onArchive: (conversation: Conversation) => void;
  onRestore: (conversation: Conversation) => void;
  onCloseMobile: () => void;
}) {
  const [search, setSearch] = useState("");
  const [remoteRows, setRemoteRows] = useState<Conversation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = search.trim();
    if (!archived && !query) {
      setRemoteRows(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (archived) params.set("archived", "true");
      if (query) params.set("q", query);
      apiRequest<Conversation[]>(`/api/dashboard/chat?${params}`, { signal: controller.signal })
        .then((rows) => {
          if (!controller.signal.aborted) setRemoteRows(rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() })));
        })
        .catch((cause) => { if (!controller.signal.aborted) setError(apiErrorMessage(cause, "تعذر تحميل المحادثات.")); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 300 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [archived, search]);

  const rows = remoteRows ?? conversations;
  const groups = useMemo(() => groupConversations(rows), [rows]);
  return (
    <aside className="conversation-sidebar" aria-label="قائمة المحادثات" data-mobile-open={mobileOpen ? "true" : "false"}>
      <header className="conversation-sidebar-header">
        <div><p className="eyebrow">مساحة العمل</p><h2>المحادثات</h2></div>
        <div className="conversation-sidebar-header-actions">
          <button type="button" className="icon-button chat-sidebar-close" onClick={onCloseMobile} aria-label="إغلاق قائمة المحادثات"><X size={18} /></button>
          <button type="button" className="icon-button" aria-label="محادثة جديدة" disabled={busy || !agents.length} onClick={onNew}><FilePlus2 size={19} /></button>
        </div>
      </header>
      <div className="conversation-sidebar-controls">
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="form-control" placeholder="ابحث في المحادثات…" aria-label="بحث في المحادثات" />
        <div className="conversation-new-row">
          <select value={selectedAgentId} onChange={(event) => onSelectAgent(event.target.value)} className="form-control" aria-label="وكيل المحادثة الجديدة">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
          <button type="button" className="primary-button" disabled={busy || !agents.length} onClick={onNew}>جديدة</button>
        </div>
        <div className="conversation-view-tabs" role="tablist"><button type="button" className={!archived ? "is-active" : ""} onClick={() => onArchivedChange(false)}>النشطة</button><button type="button" className={archived ? "is-active" : ""} onClick={() => onArchivedChange(true)}><Archive size={14} /> المؤرشفة</button></div>
      </div>
      <div className="conversation-list-scroll">
        {loading ? <div className="conversation-loading"><Loader2 className="animate-spin" size={18} /> جارٍ التحميل…</div> : null}
        {error ? <div className="conversation-error" role="alert">{error}</div> : null}
        {groups.map((group) => <section key={group.label} className="conversation-group"><h3>{group.label}</h3>{group.items.map((row) => (
          <article key={row.id} className={row.id === activeId ? "conversation-list-item is-active" : "conversation-list-item"}>
            <button type="button" className="conversation-list-main" onClick={() => onSelect(row)}>
              <span className="conversation-avatar" aria-hidden="true">{row.agentName.slice(0, 1)}</span>
              <span className="conversation-list-copy"><b>{row.title?.trim() || "محادثة بدون عنوان"}{row.pinnedAt ? <Pin size={12} aria-label="مثبتة" /> : null}</b><small>{row.summary?.trim() || row.agentName}</small></span>
              <time>{relativeTime(row.lastMessageAt ?? row.updatedAt)}</time>
            </button>
            {row.canManage !== false ? <details className="entity-menu"><summary aria-label={`إجراءات ${row.title || "المحادثة"}`}><MoreHorizontal size={18} /></summary><div>
              <button type="button" onClick={() => onSelect(row)}>فتح</button>
              <button type="button" onClick={() => onAction({ kind: "rename-conversation", row, value: row.title ?? "" })}><Pencil size={14} /> إعادة تسمية</button>
              {!archived ? <button type="button" onClick={() => onPin(row)}><Pin size={14} /> {row.pinnedAt ? "إلغاء التثبيت" : "تثبيت"}</button> : null}
              {archived ? <button type="button" onClick={() => onRestore(row)}><RotateCcw size={14} /> استعادة</button> : <button type="button" onClick={() => onArchive(row)}><Archive size={14} /> أرشفة</button>}
              <button type="button" className="danger-menu-action" onClick={() => onAction({ kind: "delete-conversation", row })}><Trash2 size={14} /> حذف</button>
            </div></details> : null}
          </article>
        ))}</section>)}
        {!loading && !error && rows.length === 0 ? <div className="conversation-empty"><p>{archived ? "لا توجد محادثات مؤرشفة." : "ابدأ محادثة جديدة مع أحد الوكلاء المنشورين."}</p>{!archived && agents.length ? <button type="button" className="primary-button" onClick={onNew}>محادثة جديدة</button> : null}</div> : null}
      </div>
    </aside>
  );
});
