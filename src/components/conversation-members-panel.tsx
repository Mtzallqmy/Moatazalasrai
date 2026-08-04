"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, UserPlus, Users, X } from "lucide-react";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import { Alert, Badge, Button, EmptyState, Select } from "@/components/ui";

type MemberRole = "reader" | "writer" | "manager";
type ConversationMember = {
  id: string;
  userId: string;
  role: MemberRole;
  name: string;
  email: string;
  organizationRole: string;
  createdAt: string;
};
type AvailableMember = {
  userId: string;
  name: string;
  email: string;
  organizationRole: string;
};
type MembersResponse = {
  conversation: { id: string; createdByUserId: string | null };
  canManage: boolean;
  members: ConversationMember[];
  availableMembers: AvailableMember[];
};

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "؟";
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

const roleLabels: Record<MemberRole, string> = {
  reader: "قارئ",
  writer: "كاتب",
  manager: "مدير",
};

export function ConversationMembersPanel({ conversationId, open, onClose }: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<MemberRole>("writer");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<MembersResponse>(`/api/dashboard/chat/members?conversationId=${encodeURIComponent(conversationId)}`);
      setData(result);
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر تحميل أعضاء المحادثة."));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose, open]);

  const candidates = useMemo(() => {
    const existing = new Set(data?.members.map((member) => member.userId) ?? []);
    return (data?.availableMembers ?? []).filter((member) => !existing.has(member.userId));
  }, [data]);

  useEffect(() => {
    if (!candidates.some((member) => member.userId === selectedUserId)) {
      setSelectedUserId(candidates[0]?.userId ?? "");
    }
  }, [candidates, selectedUserId]);

  async function saveMember(userId: string, role: MemberRole) {
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/api/dashboard/chat/members", {
        method: "POST",
        body: { conversationId, userId, role },
      });
      await load();
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر تحديث صلاحية العضو."));
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(member: ConversationMember) {
    if (!window.confirm(`إزالة ${member.name || member.email} من هذه المحادثة؟`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/api/dashboard/chat/members", {
        method: "DELETE",
        body: { conversationId, userId: member.userId },
      });
      await load();
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر إزالة العضو."));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/70 p-4" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section ref={dialogRef} className="modal-card max-h-[min(760px,90vh)] w-full max-w-2xl overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="conversation-members-title">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Conversation access</p>
            <h2 id="conversation-members-title" className="mt-1 flex items-center gap-2 text-xl font-black"><Users size={20} /> أعضاء المحادثة</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">الصلاحيات مفروضة في الخادم على القراءة والكتابة والإدارة، وليست مجرد إخفاء أزرار.</p>
          </div>
          <Button type="button" variant="ghost" className="h-10 w-10 !p-0" onClick={onClose} aria-label="إغلاق" autoFocus><X size={18} /></Button>
        </header>

        {error ? <Alert className="mt-4" tone="danger">{error}</Alert> : null}
        {loading && !data ? <div className="mt-5 skeleton h-28 rounded-2xl" /> : null}

        {data?.canManage ? (
          <form className="mt-5 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 sm:grid-cols-[minmax(0,1fr)_150px_auto]" onSubmit={(event) => {
            event.preventDefault();
            if (selectedUserId) void saveMember(selectedUserId, selectedRole);
          }}>
            <Select aria-label="عضو مساحة العمل" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} disabled={saving || candidates.length === 0}>
              {candidates.length === 0 ? <option value="">لا يوجد عضو متاح للإضافة</option> : candidates.map((member) => <option key={member.userId} value={member.userId}>{member.name || member.email} — {member.organizationRole}</option>)}
            </Select>
            <Select aria-label="صلاحية المحادثة" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as MemberRole)} disabled={saving}>
              <option value="reader">قارئ</option>
              <option value="writer">كاتب</option>
              <option value="manager">مدير</option>
            </Select>
            <Button type="submit" disabled={saving || !selectedUserId}><UserPlus size={16} /> إضافة</Button>
          </form>
        ) : null}

        <div className="mt-5 grid gap-3" aria-busy={loading || saving}>
          {data?.members.map((member) => {
            const isOwner = data.conversation.createdByUserId === member.userId;
            return (
              <article key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-sm font-black text-[var(--accent)]" aria-hidden="true">{initials(member.name, member.email)}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><strong className="truncate">{member.name || member.email}</strong>{isOwner ? <Badge>المنشئ</Badge> : null}</div>
                    <p className="truncate text-xs text-[var(--text-secondary)]">{member.email} · دور مساحة العمل: {member.organizationRole}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {data.canManage ? <Select aria-label={`صلاحية ${member.name || member.email}`} value={member.role} disabled={saving || isOwner} onChange={(event) => void saveMember(member.userId, event.target.value as MemberRole)}>
                    <option value="reader">قارئ</option><option value="writer">كاتب</option><option value="manager">مدير</option>
                  </Select> : <Badge>{roleLabels[member.role]}</Badge>}
                  {data.canManage && !isOwner ? <Button type="button" variant="danger" className="h-10 w-10 !p-0" disabled={saving} onClick={() => void removeMember(member)} aria-label={`إزالة ${member.name || member.email}`}><Trash2 size={16} /></Button> : null}
                </div>
              </article>
            );
          })}
          {!loading && data?.members.length === 0 ? <EmptyState title="لا يوجد أعضاء" description="أضف عضوًا من مساحة العمل لبدء محادثة مشتركة." /> : null}
        </div>
      </section>
    </div>
  );
}
