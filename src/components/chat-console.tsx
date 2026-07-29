"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Agent = { id: string; name: string };
type Conversation = { id: string; title: string | null; agentId: string; agentName: string; updatedAt: string };
type Message = { id: string; role: "user" | "assistant"; content: string; createdAt: string; metadata?: Record<string, unknown> };
type Attachment = { id: string; filename: string; mimeType: string; sizeBytes: number };
type Api<T> = { success?: boolean; data?: T; error?: { code?: string; message?: string; requestId?: string } };

export function ChatConsole({ agents, initialConversations, initialConversationId }: { agents: Agent[]; initialConversations: Conversation[]; initialConversationId?: string }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState(
    initialConversations.some((item) => item.id === initialConversationId)
      ? initialConversationId ?? ""
      : initialConversations[0]?.id ?? "",
  );
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(initialConversations.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const streamController = useRef<AbortController | null>(null);
  const scrollAnchor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    fetch(`/api/dashboard/chat?conversationId=${encodeURIComponent(conversationId)}&limit=100`, { signal: controller.signal })
      .then(async (response) => ({ response, result: await response.json().catch(() => null) as Api<Message[]> | null }))
      .then(({ response, result }) => {
        if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر تحميل الرسائل.");
        setMessages(result.data ?? []);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "تعذر تحميل الرسائل.");
        }
      })
      .finally(() => setLoadingMessages(false));
    return () => controller.abort();
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const timeout = window.setTimeout(() => {
      setDraft(localStorage.getItem(`chat-draft:${conversationId}`) ?? "");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const timeout = window.setTimeout(() => {
      if (draft) localStorage.setItem(`chat-draft:${conversationId}`, draft);
      else localStorage.removeItem(`chat-draft:${conversationId}`);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [conversationId, draft]);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function selectConversation(id: string) {
    if (id === conversationId || loading) return;
    setMessages([]);
    setRetryText(null);
    setError(null);
    setAttachments([]);
    setLoadingMessages(true);
    setConversationId(id);
  }

  async function conversationAction(body: Record<string, unknown>) {
    const response = await fetch("/api/dashboard/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as Api<Conversation & { deleted?: boolean }> | null;
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر تحديث المحادثة.");
    return result.data;
  }

  async function createConversation() {
    if (!agentId || loading) return;
    setLoading(true);
    setError(null);
    try {
      const created = await conversationAction({ action: "create", agentId });
      if (!created) throw new Error("تعذر إنشاء المحادثة.");
      const agentName = agents.find((agent) => agent.id === agentId)?.name ?? "وكيل";
      const row: Conversation = { ...created, agentName, updatedAt: new Date(created.updatedAt).toISOString() };
      setConversations((current) => [row, ...current]);
      setMessages([]);
      setLoadingMessages(true);
      setConversationId(row.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء المحادثة.");
    } finally {
      setLoading(false);
    }
  }

  async function renameConversation(row: Conversation) {
    const title = window.prompt("العنوان الجديد", row.title ?? "");
    if (!title?.trim()) return;
    try {
      const updated = await conversationAction({ action: "rename", conversationId: row.id, title });
      if (updated) setConversations((items) => items.map((item) => item.id === row.id ? { ...item, title: updated.title } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تغيير الاسم.");
    }
  }

  async function archiveConversation(row: Conversation) {
    try {
      await conversationAction({ action: "archive", conversationId: row.id, archived: true });
      const remaining = conversations.filter((item) => item.id !== row.id);
      setConversations(remaining);
      if (conversationId === row.id) setConversationId(remaining[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر أرشفة المحادثة.");
    }
  }

  async function deleteConversation(row: Conversation) {
    if (!window.confirm("حذف المحادثة ورسائلها نهائيًا؟")) return;
    try {
      await conversationAction({ action: "delete", conversationId: row.id });
      const remaining = conversations.filter((item) => item.id !== row.id);
      setConversations(remaining);
      if (conversationId === row.id) setConversationId(remaining[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حذف المحادثة.");
    }
  }

  async function readEventStream(response: Response, optimisticId: string) {
    if (!response.body) throw new Error("لم يبدأ الخادم بث الاستجابة.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantId = `stream-${Date.now()}`;
    let sawServerMessage = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
        const dataText = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!dataText) continue;
        const data = JSON.parse(dataText) as Record<string, unknown>;
        if (event === "message" && data.userMessage) {
          const serverMessage = data.userMessage as Message;
          sawServerMessage = true;
          setMessages((items) => items.map((item) => item.id === optimisticId ? serverMessage : item));
        } else if (event === "run" && typeof data.runId === "string") {
          setRunId(data.runId);
          assistantId = `stream-${data.runId}`;
          setMessages((items) => [...items, { id: assistantId, role: "assistant", content: "", createdAt: new Date().toISOString() }]);
        } else if (event === "delta" && typeof data.text === "string") {
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + data.text } : item));
        } else if (event === "complete" && typeof data.messageId === "string") {
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, id: String(data.messageId) } : item));
          setRetryText(null);
        } else if (event === "error") {
          throw new Error(typeof data.message === "string" ? data.message : "تعذر تشغيل الوكيل.");
        }
      }
    }
    if (!sawServerMessage) {
      const refresh = await fetch(`/api/dashboard/chat?conversationId=${encodeURIComponent(conversationId)}&limit=100`);
      const result = await refresh.json().catch(() => null) as Api<Message[]> | null;
      if (refresh.ok && result?.success) setMessages(result.data ?? []);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || !conversationId) return;
    const selected = Array.from(files).slice(0, Math.max(0, 8 - attachments.length));
    if (selected.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: Attachment[] = [];
      for (const file of selected) {
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("file", file);
        const response = await fetch("/api/dashboard/files", { method: "POST", body: form });
        const payload = await response.json().catch(() => null) as Api<Attachment> | null;
        if (!response.ok || !payload?.success || !payload.data) {
          throw new Error(payload?.error?.message ?? `تعذر رفع ${file.name}.`);
        }
        uploaded.push(payload.data);
      }
      setAttachments((current) => [...current, ...uploaded].slice(0, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر رفع الملفات.");
    } finally {
      setUploading(false);
    }
  }

  async function sendText(text: string) {
    if (!conversationId || loading || !text.trim()) return;
    const optimisticId = `local-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: optimisticId,
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setLoading(true);
    setError(null);
    setRetryText(null);
    const controller = new AbortController();
    streamController.current = controller;
    try {
      const response = await fetch("/api/dashboard/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message: text.trim(), attachmentIds: attachments.map((file) => file.id) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as Api<never> | null;
        throw new Error(result?.error?.message ?? "تعذر تشغيل الوكيل.");
      }
      await readEventStream(response, optimisticId);
      setAttachments([]);
      setDraft("");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setError("تم إيقاف التوليد.");
      } else {
        setError(cause instanceof Error ? cause.message : "تعذر تشغيل الوكيل.");
        setRetryText(text.trim());
      }
    } finally {
      setLoading(false);
      setRunId(null);
      streamController.current = null;
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("message") ?? "").trim();
    if (!text) return;
    form.reset();
    setDraft("");
    await sendText(text);
  }

  async function stop() {
    streamController.current?.abort();
    if (runId) {
      await fetch("/api/dashboard/runs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      }).catch(() => undefined);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[330px_1fr]">
      <aside className="soft-card p-4">
        <h2 className="font-bold">المحادثات</h2>
        <div className="mt-4 grid gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="form-control" placeholder="بحث في المحادثات…" aria-label="بحث في المحادثات" />
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="form-control">
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <button onClick={createConversation} disabled={loading || agents.length === 0} className="primary-button disabled:opacity-50">محادثة جديدة</button>
        </div>
        {agents.length === 0 ? <p className="mt-3 text-sm text-amber-100">انشر وكيلًا أولًا.</p> : null}
        <div className="mt-5 space-y-2">
          {conversations.filter((row) => `${row.title ?? ""} ${row.agentName}`.toLowerCase().includes(search.trim().toLowerCase())).map((row) => (
            <article key={row.id} className={`rounded-2xl border p-2 ${row.id === conversationId ? "border-emerald-200/40 bg-emerald-100/10" : "border-stone-700 bg-stone-950/40"}`}>
              <button onClick={() => selectConversation(row.id)} className="w-full px-1 py-1 text-right text-sm">
                <span className="block truncate font-semibold">{row.title || "محادثة"}</span>
                <span className="mt-1 block text-xs text-stone-500">{row.agentName}</span>
              </button>
              <div className="mt-2 flex gap-1 border-t border-stone-700/70 pt-2">
                <button className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-800" onClick={() => renameConversation(row)}>تسمية</button>
                <button className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-800" onClick={() => archiveConversation(row)}>أرشفة</button>
                <button className="rounded-lg px-2 py-1 text-xs text-rose-200 hover:bg-rose-950/40" onClick={() => deleteConversation(row)}>حذف</button>
              </div>
            </article>
          ))}
          {conversations.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-700 p-6 text-center text-sm text-stone-500">لا توجد محادثات بعد.</p> : null}
        </div>
      </aside>
      <section className="soft-card flex min-h-[680px] flex-col overflow-hidden">
        <div className="border-b border-stone-700 p-4">
          <h2 className="font-bold">دردشة الوكيل</h2>
          <p className="mt-1 text-xs text-stone-500">الرد يُعرض تدريجيًا، ويُحفظ مع سجل التشغيل بعد اكتماله فقط.</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {loadingMessages ? <div className="skeleton h-20 rounded-3xl" /> : null}
          {messages.map((message) => (
            <article key={message.id} className="max-w-[92%] rounded-2xl border px-4 py-3 text-sm leading-7 sm:max-w-[82%]" style={{
              marginRight: message.role === "user" ? "auto" : undefined,
              marginLeft: message.role === "assistant" ? "auto" : undefined,
              background: message.role === "user" ? "var(--primary-soft)" : "var(--surface-soft)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
            }}>
              <p className="whitespace-pre-wrap">{message.content || (loading ? "…" : "")}</p>
              <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                <time>{new Date(message.createdAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}</time>
                {message.content ? <button type="button" onClick={() => navigator.clipboard.writeText(message.content)}>نسخ</button> : null}
              </div>
            </article>
          ))}
          <div ref={scrollAnchor} />
        </div>
        <form onSubmit={send} className="border-t border-stone-700 p-4">
          <textarea
            name="message"
            required
            maxLength={30000}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={!conversationId || loading}
            placeholder="اكتب طلبك… Enter للإرسال وShift+Enter لسطر جديد"
            className="form-control w-full resize-none"
          />
          {attachments.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachments.map((file) => (
                <span key={file.id} className="rounded-xl border border-stone-700 bg-stone-900 px-3 py-2 text-xs">
                  {file.filename} ({Math.ceil(file.sizeBytes / 1024)}KB)
                  <button type="button" className="mr-2 text-rose-200" onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}>×</button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="secondary-button cursor-pointer text-sm">
                {uploading ? "جارٍ الرفع…" : "إرفاق ملفات"}
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  disabled={!conversationId || loading || uploading || attachments.length >= 8}
                  accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.md,.csv,.json"
                  onChange={(event) => {
                    uploadFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              {error ? <p role="alert" className="text-sm text-rose-100">{error}</p> : null}
              {retryText && !loading ? <button type="button" className="mt-2 text-sm text-emerald-100 underline" onClick={() => sendText(retryText)}>إعادة المحاولة</button> : null}
            </div>
            {loading ? (
              <button type="button" onClick={stop} className="danger-button">إيقاف التوليد</button>
            ) : (
              <button disabled={!conversationId || uploading} className="primary-button disabled:opacity-50">إرسال</button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
