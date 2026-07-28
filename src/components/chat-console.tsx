"use client";
import { FormEvent, useEffect, useState } from "react";

type Agent = { id: string; name: string };
type Conversation = { id: string; title: string | null; agentId: string; agentName: string; updatedAt: string };
type Message = { id: string; role: string; content: string; createdAt: string };
type Api<T> = { success?: boolean; data?: T; error?: { message?: string } };

export function ChatConsole({ agents, initialConversations }: { agents: Agent[]; initialConversations: Conversation[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState(initialConversations[0]?.id ?? "");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    const controller = new AbortController(); setLoading(true); setError(null);
    fetch(`/api/dashboard/chat?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal }).then(async (response) => ({ response, result: await response.json().catch(() => null) as Api<Message[]> | null })).then(({ response, result }) => { if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر تحميل الرسائل."); setMessages(result.data ?? []); }).catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "تعذر تحميل الرسائل."); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [conversationId]);

  async function createConversation() {
    if (!agentId) return; setLoading(true); setError(null);
    try {
      const response = await fetch("/api/dashboard/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", agentId }) });
      const result = await response.json().catch(() => null) as Api<{ id: string; title: string | null; agentId: string; updatedAt: string }> | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error?.message ?? "تعذر إنشاء المحادثة.");
      const agentName = agents.find((agent) => agent.id === agentId)?.name ?? "وكيل";
      const row: Conversation = { ...result.data, agentName };
      setConversations((current) => [row, ...current]); setConversationId(row.id); setMessages([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء المحادثة."); }
    finally { setLoading(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!conversationId) return;
    const form = event.currentTarget; const data = new FormData(form); const text = String(data.get("message") ?? "").trim(); if (!text) return;
    const optimistic: Message = { id: `local-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]); form.reset(); setLoading(true); setError(null);
    try {
      const response = await fetch("/api/dashboard/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "send", conversationId, message: text }) });
      const result = await response.json().catch(() => null) as Api<{ userMessage: Message; assistantMessage: Message }> | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error?.message ?? "تعذر تشغيل الوكيل.");
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), result.data!.userMessage, result.data!.assistantMessage]);
    } catch (cause) { setMessages((current) => current.filter((item) => item.id !== optimistic.id)); setError(cause instanceof Error ? cause.message : "تعذر تشغيل الوكيل."); }
    finally { setLoading(false); }
  }

  return <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
    <aside className="soft-card p-4"><h2 className="font-bold">المحادثات</h2><div className="mt-4 grid gap-2"><select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-950/70 px-3 py-3">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button onClick={createConversation} disabled={loading || agents.length === 0} className="primary-button disabled:opacity-50">محادثة جديدة</button></div>{agents.length === 0 ? <p className="mt-3 text-sm text-amber-100">انشر وكيلًا أولًا.</p> : null}<div className="mt-5 space-y-2">{conversations.map((row) => <button key={row.id} onClick={() => setConversationId(row.id)} className={`w-full rounded-2xl border px-3 py-3 text-right text-sm ${row.id === conversationId ? "border-emerald-200/40 bg-emerald-100/10" : "border-stone-700 bg-stone-950/40"}`}><span className="block truncate font-semibold">{row.title || "محادثة"}</span><span className="mt-1 block text-xs text-stone-500">{row.agentName}</span></button>)}</div></aside>
    <section className="soft-card flex min-h-[680px] flex-col overflow-hidden"><div className="border-b border-stone-700 p-4"><h2 className="font-bold">دردشة الوكيل</h2><p className="mt-1 text-xs text-stone-500">كل رسالة تنشئ Run فعليًا وتُحفظ في PostgreSQL.</p></div><div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">{messages.map((message) => <article key={message.id} className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-7 ${message.role === "user" ? "mr-auto bg-emerald-100 text-emerald-950" : "ml-auto border border-stone-700 bg-stone-900"}`}><p className="whitespace-pre-wrap">{message.content}</p></article>)}{loading && conversationId ? <p className="text-center text-sm text-stone-500">جارٍ التنفيذ...</p> : null}</div><form onSubmit={send} className="border-t border-stone-700 p-4"><textarea name="message" required maxLength={30000} rows={3} disabled={!conversationId || loading} placeholder="اكتب طلبك الحقيقي للوكيل..." className="w-full resize-none rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3" /><div className="mt-3 flex items-center justify-between gap-3">{error ? <p role="alert" className="text-sm text-rose-100">{error}</p> : <span />}<button disabled={!conversationId || loading} className="primary-button disabled:opacity-50">{loading ? "جارٍ التشغيل..." : "إرسال"}</button></div></form></section>
  </div>;
}
