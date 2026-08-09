"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Bot,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Workflow,
  XCircle,
} from "lucide-react";

type AgentRow = { id: string; name: string; description: string | null };
type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  supervisorAgentId: string;
  members: Array<{ agentId: string; role: string }>;
};
type TeamStep = {
  id: string;
  agentId: string;
  stepType: "worker" | "supervisor";
  position: number;
  status: string;
  output: string | null;
  errorCode: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
};
type RunRow = {
  id: string;
  teamId: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  input: string;
  output: string | null;
  errorCode: string | null;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  steps: TeamStep[];
};
type DashboardPayload = { agents: AgentRow[]; teams: TeamRow[]; runs: RunRow[] };

const activeStatuses = new Set<RunRow["status"]>(["queued", "running", "waiting_approval"]);
const statusLabels: Record<RunRow["status"], string> = {
  queued: "في قائمة الانتظار",
  running: "قيد التنفيذ",
  waiting_approval: "بانتظار الموافقة",
  completed: "مكتمل",
  failed: "فشل",
  cancelled: "ملغي",
};

function durationLabel(run: RunRow) {
  const start = run.startedAt ? new Date(run.startedAt).getTime() : new Date(run.createdAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds} ث`;
  return `${Math.floor(seconds / 60)} د ${seconds % 60} ث`;
}

function stepLabel(step: TeamStep, agents: AgentRow[]) {
  const agent = agents.find((item) => item.id === step.agentId)?.name ?? "وكيل";
  return step.stepType === "supervisor" ? `المشرف — ${agent}` : `العامل ${step.position + 1} — ${agent}`;
}

export function TeamManager() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const pollControllerRef = useRef<AbortController | null>(null);

  const hasActiveRuns = useMemo(() => runs.some((run) => activeStatuses.has(run.status)), [runs]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/dashboard/teams", { cache: "no-store", signal });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر تحميل الفرق.");
    const data = payload.data as DashboardPayload;
    setAgents(data.agents);
    setTeams(data.teams);
    setRuns(data.runs);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  useEffect(() => {
    if (!hasActiveRuns) return;
    const timer = window.setInterval(() => {
      pollControllerRef.current?.abort();
      const controller = new AbortController();
      pollControllerRef.current = controller;
      void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "تعذر تحديث حالة التشغيل."); });
    }, 2500);
    return () => { window.clearInterval(timer); pollControllerRef.current?.abort(); pollControllerRef.current = null; };
  }, [hasActiveRuns, load]);

  async function submit(body: Record<string, unknown>, runId?: string) {
    if (runId) setBusyRunId(runId); else setBusy(true);
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
      const action = String(body.action);
      setMessage(action === "run"
        ? "تمت إضافة تشغيل الفريق إلى قائمة العمل. ستتحدث الحالة تلقائيًا."
        : action === "cancel"
          ? "تم إرسال طلب الإلغاء."
          : action === "retry"
            ? "أعيدت المهمة الفاشلة إلى قائمة العمل."
            : "تم إنشاء فريق الوكلاء.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشلت العملية.");
    } finally {
      setBusy(false);
      setBusyRunId(null);
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
          <div><h2 className="font-extrabold">فريق جديد</h2><p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>اختر مشرفًا ووكلاء متخصصين؛ تنفذ الخطوات داخل Worker موثوق ثم يدمج المشرف النتائج.</p></div>
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
                    <button className="secondary-button" disabled={busy} type="submit">{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Play size={17} />} إضافة التشغيل</button>
                  </form>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="panel-header"><div><h2>تشغيلات الفرق</h2><p>حالة حقيقية لكل عامل والمشرف</p></div><Bot size={18} /></div>
          {runs.length === 0 ? <div className="empty-state">لم يبدأ أي تشغيل جماعي بعد.</div> : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {runs.map((run) => {
                const team = teams.find((item) => item.id === run.teamId);
                const runBusy = busyRunId === run.id;
                return (
                  <article className="p-4" key={run.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <b className="text-sm">{team?.name ?? "فريق وكلاء"}</b>
                        <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}><Clock3 size={13} /> {durationLabel(run)} — المحاولة {run.attempts}</p>
                      </div>
                      <span className={`status-chip status-${run.status}`}>{statusLabels[run.status]}</span>
                    </div>
                    <p className="mt-3 text-xs leading-6" style={{ color: "var(--text-secondary)" }}>{run.input}</p>

                    {run.status === "waiting_approval" ? (
                      <p className="mt-3 flex items-center gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}>
                        <ShieldCheck size={17} /> توقف أحد الوكلاء بأمان وينتظر قرارًا من صفحة الموافقات.
                      </p>
                    ) : null}
                    {run.errorCode ? <p className="mt-3 flex items-center gap-2 text-sm text-red-300"><XCircle size={16} /> {run.errorCode}</p> : null}

                    {run.steps.length ? (
                      <div className="mt-4 grid gap-2">
                        {run.steps.map((step) => (
                          <details className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }} key={step.id}>
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                              <span>{stepLabel(step, agents)}</span>
                              <span className={`status-chip status-${step.status}`}>{step.status}</span>
                            </summary>
                            {step.durationMs !== null ? <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>المدة: {Math.round(step.durationMs / 100) / 10} ث</p> : null}
                            {step.errorCode ? <p className="mt-2 text-xs text-red-300">{step.errorCode}</p> : null}
                            {step.output ? <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{step.output}</p> : null}
                          </details>
                        ))}
                      </div>
                    ) : null}

                    {run.output ? <details className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}><summary className="cursor-pointer text-sm font-bold"><CheckCircle2 className="inline-block ms-2" size={16} /> النتيجة النهائية</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{run.output}</p></details> : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeStatuses.has(run.status) ? <button className="danger-button" disabled={runBusy} onClick={() => void submit({ action: "cancel", teamRunId: run.id }, run.id)} type="button">{runBusy ? <LoaderCircle className="animate-spin" size={16} /> : <Ban size={16} />} إلغاء</button> : null}
                      {run.status === "failed" ? <button className="secondary-button" disabled={runBusy} onClick={() => void submit({ action: "retry", teamRunId: run.id }, run.id)} type="button">{runBusy ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />} إعادة المحاولة</button> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
