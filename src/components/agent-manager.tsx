"use client";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Provider = { id: string; name: string; provider: string; discoveredModels: string[] };
type Agent = { id: string; name: string; description: string | null; status: "draft" | "published" | "archived"; model: string; updatedAt: string };

export function AgentManager({ providers, initialAgents }: { providers: Provider[]; initialAgents: Agent[] }) {
  const router = useRouter();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [agents, setAgents] = useState(initialAgents);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const models = useMemo(() => providers.find((item) => item.id === providerId)?.discoveredModels ?? [], [providerId, providers]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setLoading(true); setMessage(null);
    try {
      const response = await fetch("/api/dashboard/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), description: data.get("description"), providerCredentialId: providerId, model: data.get("model"), instructions: data.get("instructions"), publish: data.get("publish") === "on" }) });
      const result = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر إنشاء الوكيل.");
      setMessage("تم إنشاء الوكيل وربطه بالنموذج المحفوظ بنجاح.");
      form.reset(); router.refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "تعذر إنشاء الوكيل."); }
    finally { setLoading(false); }
  }

  async function changeStatus(id: string, status: Agent["status"]) {
    setLoading(true); setMessage(null);
    try {
      const response = await fetch("/api/dashboard/agents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
      const result = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر تحديث الوكيل.");
      setAgents((current) => current.map((item) => item.id === id ? { ...item, status } : item));
      setMessage("تم تحديث حالة الوكيل.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "تعذر تحديث الوكيل."); }
    finally { setLoading(false); }
  }

  return <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
    <form onSubmit={create} className="soft-card grid content-start gap-4 p-5">
      <h2 className="text-lg font-bold">إنشاء وكيل فعلي</h2>
      {providers.length === 0 ? <p className="rounded-2xl border border-amber-200/20 bg-amber-200/10 p-3 text-sm text-amber-100">أضف مزودًا وافحصه أولًا؛ لا يمكن إنشاء وكيل دون نموذج محفوظ.</p> : null}
      <input name="name" required maxLength={100} placeholder="اسم الوكيل" className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3" />
      <textarea name="description" maxLength={1000} rows={2} placeholder="وصف مختصر" className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3" />
      <select value={providerId} onChange={(event) => setProviderId(event.target.value)} required className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3">{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.provider}</option>)}</select>
      <select name="model" required className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 font-mono text-sm" dir="ltr">{models.map((model) => <option key={model} value={model}>{model}</option>)}</select>
      <textarea name="instructions" required minLength={10} maxLength={30000} rows={8} placeholder="تعليمات النظام الدقيقة للوكيل" className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 leading-7" />
      <label className="flex items-center gap-2 text-sm text-stone-300"><input name="publish" type="checkbox" /> نشر الوكيل مباشرة للدردشة</label>
      <button disabled={loading || providers.length === 0 || models.length === 0} className="primary-button disabled:opacity-50">{loading ? "جارٍ الحفظ..." : "إنشاء الوكيل"}</button>
      {message ? <p role="status" className="rounded-2xl border border-stone-700 p-3 text-sm">{message}</p> : null}
    </form>
    <section className="soft-card p-5">
      <h2 className="text-lg font-bold">الوكلاء المحفوظون</h2>
      {agents.length === 0 ? <p className="mt-5 rounded-2xl border border-dashed border-stone-700 p-10 text-center text-sm text-stone-400">لا توجد وكلاء بعد.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{agents.map((agent) => <article key={agent.id} className="rounded-2xl border border-stone-700 bg-stone-950/45 p-4"><div className="flex items-start justify-between gap-3"><h3 className="font-bold">{agent.name}</h3><span className="rounded-full bg-stone-800 px-2 py-1 text-xs">{agent.status}</span></div><p className="mt-3 font-mono text-xs text-emerald-100" dir="ltr">{agent.model}</p>{agent.description ? <p className="mt-3 text-sm leading-7 text-stone-400">{agent.description}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><button disabled={loading} onClick={() => changeStatus(agent.id, "published")} className="secondary-button px-3 py-2 text-xs">نشر</button><button disabled={loading} onClick={() => changeStatus(agent.id, "draft")} className="secondary-button px-3 py-2 text-xs">مسودة</button><button disabled={loading} onClick={() => changeStatus(agent.id, "archived")} className="rounded-xl border border-rose-200/20 px-3 py-2 text-xs text-rose-100">أرشفة</button></div></article>)}</div>}
    </section>
  </div>;
}
