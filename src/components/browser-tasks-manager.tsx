"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CircleAlert, Globe2, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { Badge, Button, Card, EmptyState, Select, Textarea } from "@/components/ui";

type Envelope<T> = { success: true; data: T } | { success: false; error: { message: string } };
type AgentAssignment = { agentId: string; agentName: string; enabled: boolean };
type SiteConnection = {
  id: string;
  name: string;
  siteDomain: string;
  connectorType: string;
  status: string;
  agents: AgentAssignment[];
};
type BrowserTask = {
  id: string;
  agentId: string;
  agentName?: string;
  siteConnectionId: string;
  connectionName?: string;
  siteDomain?: string;
  instruction: string;
  status: string;
  riskLevel: string;
  currentStep: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
  steps?: Array<{
    id: string;
    sequence: number;
    action: string;
    status: string;
    riskLevel: string;
    expectedResult?: string | null;
    result?: Record<string, unknown> | null;
  }>;
};

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? "فشل الطلب." : payload.error.message);
  }
  return payload.data;
}

const tones: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  queued: "neutral",
  planning: "warning",
  awaiting_connection: "warning",
  running: "warning",
  awaiting_approval: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  expired: "danger",
};

export function BrowserTasksManager() {
  const [tasks, setTasks] = useState<BrowserTask[]>([]);
  const [connections, setConnections] = useState<SiteConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<BrowserTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const availableConnections = useMemo(() => connections.filter((item) =>
    item.connectorType === "browser" && item.status === "verified" && item.agents.some((agent) => agent.enabled)), [connections]);
  const availableAgents = useMemo(() =>
    availableConnections.find((item) => item.id === connectionId)?.agents.filter((agent) => agent.enabled) ?? [],
  [availableConnections, connectionId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const [taskRows, connectionRows] = await Promise.all([
        api<BrowserTask[]>("/api/dashboard/browser-tasks?limit=100", { signal }),
        api<SiteConnection[]>("/api/dashboard/site-connections", { signal }),
      ]);
      if (signal?.aborted) return;
      setTasks(taskRows);
      setConnections(connectionRows);
      const nextConnection = connectionRows.find((item) =>
        item.connectorType === "browser" && item.status === "verified" && item.agents.some((agent) => agent.enabled));
      setConnectionId((current) => connectionRows.some((item) => item.id === current) ? current : nextConnection?.id ?? "");
      setSelectedId((current) => taskRows.some((item) => item.id === current) ? current : taskRows[0]?.id ?? "");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل مهام المتصفح.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const loadTask = useCallback(async (id: string, signal?: AbortSignal) => {
    if (!id) {
      setSelected(null);
      return;
    }
    try {
      const task = await api<BrowserTask>(`/api/dashboard/browser-tasks?id=${encodeURIComponent(id)}`, { signal });
      if (!signal?.aborted) setSelected(task);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل تفاصيل المهمة.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadTask(selectedId, controller.signal); }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadTask, selectedId]);

  useEffect(() => {
    if (availableAgents.some((agent) => agent.agentId === agentId)) return;
    const timer = window.setTimeout(() => {
      setAgentId(availableAgents[0]?.agentId ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [availableAgents, agentId]);

  async function createTask() {
    if (!connectionId || !agentId || !instruction.trim()) return;
    setSaving(true);
    setError("");
    try {
      const created = await api<BrowserTask>("/api/dashboard/browser-tasks", {
        method: "POST",
        body: JSON.stringify({
          connectionId,
          agentId,
          instruction: instruction.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setInstruction("");
      await load();
      setSelectedId(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء مهمة المتصفح.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelTask(id: string) {
    setSaving(true);
    setError("");
    try {
      await api("/api/dashboard/browser-tasks", {
        method: "DELETE",
        body: JSON.stringify({ browserTaskId: id }),
      });
      await load();
      await loadTask(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إلغاء المهمة.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="mx-auto max-w-[1500px] space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow">Browser Agent</p>
            <h1 className="mt-2 text-2xl font-extrabold">مهام المتصفح المقيدة بالسياسات</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--text-secondary)]">يُنفذ الوكيل خطة منظمة داخل اتصال متصفح موثق، وتتوقف الخطوات الحساسة تلقائيًا عند صندوق الموافقات.</p>
          </div>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} size={16} /> تحديث</Button>
        </div>
      </Card>

      {error ? <div role="alert" className="rounded-xl border border-red-300/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200"><CircleAlert className="me-2 inline" size={18} />{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="font-extrabold">إنشاء مهمة</h2>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-2 text-sm font-semibold">الاتصال
              <Select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
                <option value="">اختر اتصال متصفح</option>
                {availableConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name} — {connection.siteDomain}</option>)}
              </Select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">الوكيل
              <Select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={!connectionId}>
                <option value="">اختر الوكيل</option>
                {availableAgents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.agentName}</option>)}
              </Select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">التعليمات
              <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={6} maxLength={8_000} placeholder="افتح لوحة الحساب، اقرأ حالة الطلب، ثم حدّث الحقل المحدد فقط." />
            </label>
            <Button disabled={saving || !connectionId || !agentId || !instruction.trim()} onClick={() => void createTask()}>
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />} تشغيل المهمة
            </Button>
            {!availableConnections.length && !loading ? <p className="rounded-xl bg-amber-500/10 p-3 text-xs leading-6 text-amber-800 dark:text-amber-200">اربط جلسة متصفح موثقة وامنح وكيلًا صلاحياتها أولًا من صفحة الحسابات المتصلة.</p> : null}
          </div>
        </Card>

        <section className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-[var(--border)] p-4"><h2 className="font-extrabold">المهام</h2></div>
            <div className="max-h-[720px] overflow-auto p-2">
              {tasks.map((task) => <button key={task.id} type="button" onClick={() => setSelectedId(task.id)} className={`mb-2 w-full rounded-xl border p-3 text-start ${selectedId === task.id ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]"}`}>
                <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-bold">{task.instruction}</p><Badge tone={tones[task.status] ?? "neutral"}>{task.status}</Badge></div>
                <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]"><Globe2 size={14} />{task.siteDomain ?? task.connectionName ?? task.siteConnectionId}</div>
              </button>)}
              {!tasks.length && !loading ? <EmptyState title="لا توجد مهام" description="أنشئ أول مهمة متصفح من النموذج المجاور." /> : null}
            </div>
          </Card>

          <Card className="p-5">
            {!selected ? <EmptyState title="اختر مهمة" description="ستظهر الخطة والخطوات ونتيجة التنفيذ هنا." /> : <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-lg font-extrabold">تفاصيل المهمة</h2><p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">{selected.instruction}</p></div>
                <div className="flex items-center gap-2"><Badge tone={tones[selected.status] ?? "neutral"}>{selected.status}</Badge>{!["completed", "failed", "cancelled", "expired"].includes(selected.status) ? <Button size="sm" variant="danger" disabled={saving} onClick={() => void cancelTask(selected.id)}><Square size={14} /> إلغاء</Button> : null}</div>
              </div>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-xl bg-[var(--surface-soft)] p-3"><dt className="text-xs text-[var(--text-secondary)]">الوكيل</dt><dd className="mt-1 font-bold"><Bot className="me-1 inline" size={14} />{selected.agentName ?? selected.agentId}</dd></div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-3"><dt className="text-xs text-[var(--text-secondary)]">المخاطر</dt><dd className="mt-1 font-bold">{selected.riskLevel}</dd></div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-3"><dt className="text-xs text-[var(--text-secondary)]">الخطوة الحالية</dt><dd className="mt-1 font-bold">{selected.currentStep}</dd></div>
              </dl>
              {selected.errorCode ? <div className="mt-4 rounded-xl border border-red-300/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">{selected.errorCode}: {selected.errorMessage}</div> : null}
              <div className="mt-5 space-y-3">
                {(selected.steps ?? []).map((step) => <article key={step.id} className="rounded-xl border border-[var(--border)] p-4">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-[var(--text-secondary)]">الخطوة {step.sequence + 1}</p><h3 className="mt-1 font-bold">{step.action}</h3></div><Badge tone={tones[step.status] ?? "neutral"}>{step.status}</Badge></div>
                  {step.expectedResult ? <p className="mt-2 text-sm text-[var(--text-secondary)]">{step.expectedResult}</p> : null}
                </article>)}
                {!selected.steps?.length ? <p className="py-8 text-center text-sm text-[var(--text-secondary)]">لم تُحفظ خطوات الخطة بعد.</p> : null}
              </div>
            </>}
          </Card>
        </section>
      </div>
  </div>;
}
