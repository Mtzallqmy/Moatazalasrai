"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Provider = { id: string; name: string; provider: string; discoveredModels: string[] };
type Agent = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  model: string;
  providerCredentialId: string;
  updatedAt: string;
};
type Version = {
  id: string;
  version: number;
  providerCredentialId: string;
  model: string;
  instructions: string;
  temperatureMilli: number;
  maxOutputTokens: number;
  createdAt: string;
};
type Details = { agent: Agent; versions: Version[] };

export function AgentManager({ providers, initialAgents }: { providers: Provider[]; initialAgents: Agent[] }) {
  const router = useRouter();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [agents, setAgents] = useState(initialAgents);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [editProviderId, setEditProviderId] = useState("");
  const models = useMemo(() => providers.find((item) => item.id === providerId)?.discoveredModels ?? [], [providerId, providers]);
  const editModels = useMemo(() => providers.find((item) => item.id === editProviderId)?.discoveredModels ?? [], [editProviderId, providers]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          description: data.get("description"),
          providerCredentialId: providerId,
          model: data.get("model"),
          instructions: data.get("instructions"),
          temperature: Number(data.get("temperature")),
          maxOutputTokens: Number(data.get("maxOutputTokens")),
          publish: data.get("publish") === "on",
        }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "تعذر إنشاء الوكيل.");
      setMessage("تم إنشاء الوكيل وإصداره الأول بنجاح.");
      form.reset();
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر إنشاء الوكيل.");
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(agent: Agent, status: Agent["status"]) {
    if (busyId) return;
    setBusyId(agent.id);
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/agents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: agent.id, status }),
      });
      const result = await response.json().catch(() => null) as {
        success?: boolean;
        data?: { agent?: Agent; version?: Version };
        error?: { message?: string };
      } | null;
      if (!response.ok || !result?.success || !result.data?.agent) {
        throw new Error(result?.error?.message ?? "تعذر تحديث الوكيل.");
      }
      const updated = result.data.agent;
      setAgents((current) => current.map((item) => item.id === agent.id ? {
        ...item,
        status: updated.status,
        currentVersion: updated.currentVersion,
      } : item));
      setMessage(status === "published" ? "تم نشر إصدار ثابت جديد للوكيل." : "تم تحديث حالة الوكيل.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر تحديث الوكيل.");
    } finally {
      setBusyId(null);
    }
  }

  async function openEditor(agent: Agent) {
    setBusyId(agent.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/dashboard/agents?id=${encodeURIComponent(agent.id)}`);
      const result = await response.json().catch(() => null) as { success?: boolean; data?: Details; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error?.message ?? "تعذر تحميل تفاصيل الوكيل.");
      setDetails({
        agent: { ...agent, ...result.data.agent },
        versions: result.data.versions.map((version) => ({ ...version, createdAt: String(version.createdAt) })),
      });
      setEditProviderId(result.data.versions[0]?.providerCredentialId ?? agent.providerCredentialId);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر تحميل تفاصيل الوكيل.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || loading) return;
    const data = new FormData(event.currentTarget);
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/agents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: details.agent.id,
          name: data.get("name"),
          description: data.get("description"),
          providerCredentialId: editProviderId,
          model: data.get("model"),
          instructions: data.get("instructions"),
          temperature: Number(data.get("temperature")),
          maxOutputTokens: Number(data.get("maxOutputTokens")),
        }),
      });
      const result = await response.json().catch(() => null) as {
        success?: boolean;
        data?: { agent: Agent; version: Version };
        error?: { message?: string };
      } | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error?.message ?? "تعذر حفظ الوكيل.");
      setAgents((items) => items.map((item) => item.id === details.agent.id ? {
        ...item,
        name: result.data!.agent.name,
        description: result.data!.agent.description,
        currentVersion: result.data!.agent.currentVersion,
        model: result.data!.version.model,
        providerCredentialId: result.data!.version.providerCredentialId,
      } : item));
      setDetails(null);
      setMessage("تم حفظ التعديل كإصدار جديد غير قابل للتغيير.");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر حفظ الوكيل.");
    } finally {
      setLoading(false);
    }
  }

  const latest = details?.versions[0];
  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <form onSubmit={create} className="soft-card grid content-start gap-4 p-5">
        <h2 className="text-lg font-bold">إنشاء وكيل فعلي</h2>
        {providers.length === 0 ? <p className="rounded-2xl border border-amber-200/20 bg-amber-200/10 p-3 text-sm text-amber-100">أضف مزودًا وافحصه أولًا؛ لا يمكن إنشاء وكيل دون نموذج محفوظ.</p> : null}
        <label className="grid gap-2 text-sm">الاسم<input name="name" required maxLength={100} className="form-control" /></label>
        <label className="grid gap-2 text-sm">الوصف<textarea name="description" maxLength={1000} rows={2} className="form-control" /></label>
        <label className="grid gap-2 text-sm">المزود<select value={providerId} onChange={(event) => setProviderId(event.target.value)} required className="form-control">{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.provider}</option>)}</select></label>
        <label className="grid gap-2 text-sm">النموذج<select name="model" required className="form-control font-mono text-sm" dir="ltr">{models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
        <label className="grid gap-2 text-sm">تعليمات النظام<textarea name="instructions" required minLength={1} maxLength={30000} rows={8} className="form-control leading-7" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2 text-sm">Temperature<input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={0.2} className="form-control" dir="ltr" /></label>
          <label className="grid gap-2 text-sm">حد الإخراج<input name="maxOutputTokens" type="number" min={64} max={32768} defaultValue={2048} className="form-control" dir="ltr" /></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-300"><input name="publish" type="checkbox" /> نشر الوكيل مباشرة</label>
        <button disabled={loading || providers.length === 0 || models.length === 0} className="primary-button disabled:opacity-50">{loading ? "جارٍ الحفظ..." : "إنشاء الوكيل"}</button>
        {message ? <p role="status" className="rounded-2xl border border-stone-700 p-3 text-sm">{message}</p> : null}
      </form>
      <section className="soft-card p-5">
        <h2 className="text-lg font-bold">الوكلاء المحفوظون</h2>
        {agents.length === 0 ? (
          <p className="mt-5 rounded-2xl border border-dashed border-stone-700 p-10 text-center text-sm text-stone-400">لا توجد وكلاء بعد.</p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <article key={agent.id} className="rounded-2xl border border-stone-700 bg-stone-950/45 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold">{agent.name}</h3>
                  <span className={`status-badge ${agent.status === "published" ? "status-success" : agent.status === "archived" ? "status-error" : "status-neutral"}`}>{agent.status}</span>
                </div>
                <p className="mt-2 text-xs text-stone-500">الإصدار الحالي: {agent.currentVersion}</p>
                <p className="mt-3 font-mono text-xs text-emerald-100" dir="ltr">{agent.model}</p>
                {agent.description ? <p className="mt-3 text-sm leading-7 text-stone-400">{agent.description}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button disabled={busyId !== null} onClick={() => openEditor(agent)} className="secondary-button px-3 py-2 text-xs">تعديل وإصدارات</button>
                  {agent.status !== "published" ? <button disabled={busyId !== null} onClick={() => changeStatus(agent, "published")} className="secondary-button px-3 py-2 text-xs">نشر</button> : null}
                  {agent.status !== "archived" ? <button disabled={busyId !== null} onClick={() => changeStatus(agent, "archived")} className="danger-button px-3 py-2 text-xs">أرشفة</button> : <button disabled={busyId !== null} onClick={() => changeStatus(agent, "draft")} className="secondary-button px-3 py-2 text-xs">استعادة كمسودة</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {details && latest ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="agent-editor-title">
            <h2 id="agent-editor-title" className="text-xl font-bold">تعديل الوكيل وسجل الإصدارات</h2>
            <form onSubmit={saveEdit} className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm">الاسم<input name="name" defaultValue={details.agent.name} required maxLength={100} className="form-control" /></label>
              <label className="grid gap-2 text-sm">الوصف<textarea name="description" defaultValue={details.agent.description ?? ""} maxLength={1000} rows={2} className="form-control" /></label>
              <label className="grid gap-2 text-sm">المزود<select value={editProviderId} onChange={(event) => setEditProviderId(event.target.value)} className="form-control">{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
              <label className="grid gap-2 text-sm">النموذج<select name="model" defaultValue={editModels.includes(latest.model) ? latest.model : editModels[0]} className="form-control font-mono" dir="ltr">{editModels.map((model) => <option key={model}>{model}</option>)}</select></label>
              <label className="grid gap-2 text-sm">تعليمات النظام<textarea name="instructions" defaultValue={latest.instructions} required maxLength={30000} rows={7} className="form-control leading-7" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-2 text-sm">Temperature<input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={latest.temperatureMilli / 1000} className="form-control" /></label>
                <label className="grid gap-2 text-sm">حد الإخراج<input name="maxOutputTokens" type="number" min={64} max={32768} defaultValue={latest.maxOutputTokens} className="form-control" /></label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="secondary-button" onClick={() => setDetails(null)}>إلغاء</button>
                <button disabled={loading || editModels.length === 0} className="primary-button">{loading ? "جارٍ الحفظ..." : "حفظ كإصدار جديد"}</button>
              </div>
            </form>
            <section className="mt-6 border-t border-stone-700 pt-5">
              <h3 className="font-bold">الإصدارات السابقة</h3>
              <div className="mt-3 space-y-2">
                {details.versions.map((version) => (
                  <details key={version.id} className="rounded-2xl border border-stone-700 p-3">
                    <summary className="cursor-pointer text-sm">الإصدار {version.version} — <span dir="ltr" className="font-mono text-xs">{version.model}</span></summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-400">{version.instructions}</p>
                    <p className="mt-2 text-xs text-stone-500">{new Date(version.createdAt).toLocaleString("ar")} — {version.maxOutputTokens} token</p>
                  </details>
                ))}
              </div>
            </section>
          </section>
        </div>
      ) : null}
    </div>
  );
}
