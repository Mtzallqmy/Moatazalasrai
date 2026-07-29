"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, CheckCircle2, LoaderCircle, Play, Plus, Workflow } from "lucide-react";

type AgentRow = { id: string; name: string; description: string | null };
type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  supervisorAgentId: string;
  members: Array<{ agentId: string; role: string }>;
};
type RunRow = { id: string; teamId: string; status: string; input: string; output: string | null; createdAt: string };

export function TeamManager() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard/teams", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر تحميل الفرق.");
    setAgents(payload.data.agents);
    setTeams(payload.data.teams);
    setRuns(payload.data.runs);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((error) => setMessage(error.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/teams", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "فشلت العملية.");
      await load();
      setMessage(body.action === "run" ? "اكتمل تشغيل الفريق وحفظت نتيجة كل وكيل." : "تم إنشاء فريق الوكلاء.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشلت العملية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="dashboard-panel p-4 sm:p-5" onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        const members = form.getAll("members").map(String);
        void submit({
          action: "create",
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? "") || undefined,
          supervisorAgentId: String(form.get("supervisor") ?? ""),
          memberAgentIds: members,
        }).then(() => element.reset());
      }}>
        <div className="mb-4 flex items-start gap-3">
          <span className="metric-icon"><Workflow size={18} /></span>
          <div><h2 className="font-extrabold">فريق جديد</h2><p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>اختر مشرفاً ووكلاء متخصصين؛ ينفذ الأعضاء بالتوازي ثم يدمج المشرف النتائج.</p></div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="form-control" name="name" required placeholder="اسم الفريق" />
          <input className="form-control" name="description" placeholder="وصف المهمة المتكررة" />
          <label className="grid gap-2 text-sm"><span>وكيل الإشراف</span><select className="form-control" name="supervisor" required><option value="">اختر المشرف</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label>
          <fieldset className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <legend className="px-2 text-sm font-bold">الوكلاء العاملون</legend>
            <div className="grid max-h-36 gap-2 overflow-y-auto">
              {agents.map((agent) => <label className="flex items-center gap-2 text-sm" key={agent.id}><input type="checkbox" name="members" value={agent.id} /><span>{agent.name}</span></label>)}
            </div>
          </fieldset>
        </div>
        <button className="primary-button mt-4" disabled={busy || agents.length < 2} type="submit"><Plus size={17} /> إنشاء الفريق</button>
      </form>

      {message ? <p className="rounded-xl border p-3 text-sm" role="status" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <section className="dashboard-panel">
          <div className="panel-header"><div><h2>الفرق الجاهزة</h2><p>{teams.length} فريق متعدد الوكلاء</p></div><Workflow size={18} /></div>
          {teams.length === 0 ? <div className="empty-state">أنشئ أول فريق بعد نشر وكيلين على الأقل.</div> : (
            <div className="grid gap-3 p-4">
              {teams.map((team) => (
                <article className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }} key={team.id}>
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{team.name}</h3><p className="mt-1 text-xs leading-6" style={{ color: "var(--text-secondary)" }}>{team.description || "فريق تنفيذي متعدد التخصصات"}</p></div><span className="status-chip status-completed">{team.members.length} وكلاء</span></div>
                  <form className="mt-4 grid gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void submit({ action: "run", teamId: team.id, input: String(form.get("input") ?? "") });
                  }}>
                    <textarea className="form-control min-h-24 resize-y" name="input" required placeholder="اكتب الهدف الذي سينفذه الفريق…" />
                    <button className="secondary-button" disabled={busy} type="submit">{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Play size={17} />} تشغيل الفريق</button>
                  </form>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="dashboard-panel">
          <div className="panel-header"><div><h2>نتائج التنسيق</h2><p>سجل نتائج المشرف وأعضاء الفريق</p></div><Bot size={18} /></div>
          {runs.length === 0 ? <div className="empty-state">لم يبدأ أي تشغيل جماعي بعد.</div> : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {runs.map((run) => (
                <article className="p-4" key={run.id}>
                  <div className="flex items-center justify-between gap-3"><b className="text-sm">{teams.find((team) => team.id === run.teamId)?.name ?? "فريق وكلاء"}</b><span className={`status-chip status-${run.status}`}>{run.status}</span></div>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>{run.input}</p>
                  {run.output ? <details className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}><summary className="cursor-pointer text-sm font-bold"><CheckCircle2 className="inline-block ms-2" size={16} /> عرض النتيجة</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{run.output}</p></details> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
