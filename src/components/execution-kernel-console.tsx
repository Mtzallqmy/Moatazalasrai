"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Ban, Box, FileCheck2, Play, RefreshCw, TerminalSquare } from "lucide-react";

type JobRow = {
  id: string;
  kind: string;
  status: string;
  runnerKind: string;
  userId: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  errorCode: string | null;
  errorReference: string | null;
  createdAt: string | Date;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  updatedAt: string | Date;
  stdoutBytes: number | null;
  stderrBytes: number | null;
  artifactBytes: number | null;
  memoryPeakBytes: number | null;
};

type ExecutionEvent = {
  sequence: number;
  type: string;
  source: string;
  level: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type ExecutionDetail = {
  id: string;
  kind: string;
  status: string;
  runnerKind: string;
  limits: Record<string, unknown>;
  networkPolicy: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  errorCode: string | null;
  errorReference: string | null;
  attempts: { current: number; maximum: number };
  cancelRequestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  usage: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
  artifacts: Array<{
    id: string;
    filename: string;
    mediaType: string;
    sizeBytes: number;
    sha256: string;
    kind: string;
    downloadUrl: string;
  }>;
  recentEvents: ExecutionEvent[];
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string };
};

const terminalStatuses = new Set(["completed", "failed", "timed_out", "cancelled"]);

function shortId(id: string) {
  return id.slice(0, 8);
}

function formatDate(value: string | Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar-SA");
}

function formatBytes(value: number | null | undefined) {
  const bytes = value ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function elapsed(start: string | Date | null, end: string | Date | null) {
  if (!start) return "—";
  const milliseconds = Math.max(0, new Date(end ?? Date.now()).getTime() - new Date(start).getTime());
  return `${(milliseconds / 1000).toFixed(1)} ث`;
}

function outputFrom(events: ExecutionEvent[], type: "stdout.chunk" | "stderr.chunk") {
  return events
    .filter((event) => event.type === type)
    .map((event) => typeof event.payload.text === "string" ? event.payload.text : "")
    .filter(Boolean)
    .join("");
}

export function ExecutionKernelConsole(props: { initialJobs: JobRow[]; canRun: boolean }) {
  const [jobs, setJobs] = useState(props.initialJobs);
  const [selectedId, setSelectedId] = useState<string | null>(props.initialJobs[0]?.id ?? null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refreshJobs = useCallback(async () => {
    const response = await fetch("/api/executions?limit=25", { cache: "no-store" });
    const payload = await response.json() as ApiResponse<JobRow[]>;
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر تحميل عمليات التنفيذ.");
    setJobs(payload.data);
  }, []);

  const loadDetail = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/executions/${jobId}`, { cache: "no-store" });
    const payload = await response.json() as ApiResponse<ExecutionDetail>;
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر تحميل تفاصيل التنفيذ.");
    setDetail(payload.data);
    setEvents(payload.data.recentEvents);
    setStdout(outputFrom(payload.data.recentEvents, "stdout.chunk"));
    setStderr(outputFrom(payload.data.recentEvents, "stderr.chunk"));
  }, []);

  const openJob = useCallback(async (jobId: string) => {
    setSelectedId(jobId);
    setMessage("");
    try { await loadDetail(jobId); }
    catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تحميل التنفيذ."); }
  }, [loadDetail]);

  useEffect(() => {
    if (!selectedId) return;
    const source = new EventSource(`/api/executions/${selectedId}/events`);
    const handle = (event: MessageEvent<string>) => {
      let parsed: ExecutionEvent;
      try { parsed = JSON.parse(event.data) as ExecutionEvent; } catch { return; }
      setEvents((current) => current.some((item) => item.sequence === parsed.sequence)
        ? current
        : [...current, parsed].slice(-500));
      if (parsed.type === "stdout.chunk" && typeof parsed.payload.text === "string") {
        setStdout((current) => `${current}${parsed.payload.text}`.slice(-200_000));
      }
      if (parsed.type === "stderr.chunk" && typeof parsed.payload.text === "string") {
        setStderr((current) => `${current}${parsed.payload.text}`.slice(-200_000));
      }
      if (parsed.type.startsWith("job.") || parsed.type === "workspace.destroyed" || parsed.type.startsWith("artifact.")) {
        void Promise.all([loadDetail(selectedId), refreshJobs()]).catch(() => undefined);
      }
    };
    const names = [
      "job.created", "job.queued", "workspace.provisioning", "workspace.ready", "step.started", "process.started",
      "stdout.chunk", "stderr.chunk", "artifact.discovered", "artifact.stored", "cancel.requested", "process.terminated",
      "step.completed", "step.failed", "job.completed", "job.failed", "job.timed_out", "job.cancelled", "workspace.destroyed",
    ];
    names.forEach((name) => source.addEventListener(name, handle as EventListener));
    source.onerror = () => {
      if (detail && terminalStatuses.has(detail.status)) source.close();
    };
    return () => source.close();
  }, [detail, loadDetail, refreshJobs, selectedId]);

  async function runDiagnostic() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/executions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "diagnostic.command",
          idempotencyKey: `diagnostic:${crypto.randomUUID()}`,
          input: { scenario: "success" },
        }),
      });
      const payload = await response.json() as ApiResponse<{ jobId: string }>;
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر إنشاء التشخيص.");
      await refreshJobs();
      await openJob(payload.data.jobId);
      setMessage("تم إنشاء Job دائمة. النجاح لن يظهر قبل اكتمال التنفيذ وتخزين Artifact وتنظيف Workspace.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تشغيل التشخيص.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelected() {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/executions/${selectedId}/cancel`, { method: "POST" });
      const payload = await response.json() as ApiResponse<{ status: string }>;
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر طلب الإلغاء.");
      await Promise.all([loadDetail(selectedId), refreshJobs()]);
      setMessage("سُجل طلب الإلغاء. لن تظهر cancelled حتى يؤكد Runner توقف العملية.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر طلب الإلغاء.");
    } finally {
      setBusy(false);
    }
  }

  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) ?? null, [jobs, selectedId]);
  const cancellable = detail && !terminalStatuses.has(detail.status) && detail.status !== "cancel_requested" && detail.status !== "cancelling";

  return (
    <main id="main-content" className="space-y-5">
      <header className="page-hero">
        <p className="eyebrow">التشغيل الآمن</p>
        <h1>Execution Kernel</h1>
        <p>تشخيص واحد ثابت يثبت دورة PostgreSQL ← Graphile Worker ← Runner معزول ← أحداث ← Artifact ← Cleanup.</p>
      </header>

      <section className="soft-card grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <h2 className="font-bold">Execution Kernel Diagnostic</h2>
          <p className="mt-1 text-sm text-stone-500">يشغل Python بوسيطات argv ثابتة، يطبع 4، ينشئ result.txt، يخزنه كـArtifact ثم يدمر Workspace.</p>
        </div>
        {props.canRun ? (
          <button className="primary-button" type="button" disabled={busy} onClick={() => void runDiagnostic()}>
            <Play size={17} /> {busy ? "جارٍ الإنشاء…" : "تشغيل التشخيص"}
          </button>
        ) : <p className="text-sm text-stone-500">تحتاج صلاحية executions:run لتشغيل التشخيص.</p>}
      </section>

      {message ? <p role="status" className="soft-card p-3 text-sm">{message}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="soft-card overflow-hidden">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="font-bold">العمليات</h2>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshJobs()} aria-label="تحديث العمليات">
              <RefreshCw size={16} /> تحديث
            </button>
          </div>
          <div className="max-h-[38rem] overflow-y-auto p-2">
            {jobs.length ? jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`mb-2 w-full rounded-xl border p-3 text-start ${selectedId === job.id ? "bg-[var(--selected)]" : "bg-[var(--surface)]"}`}
                onClick={() => void openJob(job.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">#{shortId(job.id)}</span>
                  <span className="rounded-full border px-2 py-1 text-[11px]">{job.status}</span>
                </div>
                <p className="mt-2 text-sm font-semibold">{job.kind}</p>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-stone-500">
                  <span>{job.runnerKind}</span>
                  <span>{formatDate(job.createdAt)}</span>
                  <span>انتظار/تنفيذ: {elapsed(job.startedAt, job.completedAt)}</span>
                  <span>مخرجات: {formatBytes((job.stdoutBytes ?? 0) + (job.stderrBytes ?? 0))}</span>
                </div>
              </button>
            )) : <p className="p-4 text-sm text-stone-500">لا توجد عمليات تنفيذ بعد.</p>}
          </div>
        </section>

        <section className="space-y-4">
          {selectedId && !detail ? (
            <button className="secondary-button" type="button" onClick={() => void openJob(selectedId)}>تحميل التفاصيل</button>
          ) : null}
          {detail ? (
            <>
              <div className="soft-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-stone-500">#{shortId(detail.id)}</p>
                    <h2 className="mt-1 text-lg font-bold">{detail.kind}</h2>
                    <p className="text-sm text-stone-500">Runner: {detail.runnerKind} · الحالة: {detail.status}</p>
                  </div>
                  {props.canRun && cancellable ? (
                    <button className="danger-button" type="button" disabled={busy} onClick={() => void cancelSelected()}>
                      <Ban size={16} /> طلب الإلغاء
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric icon={<Activity size={16} />} label="المدة" value={elapsed(detail.startedAt, detail.completedAt)} />
                  <Metric icon={<TerminalSquare size={16} />} label="stdout/stderr" value={`${formatBytes(Number(detail.usage?.stdoutBytes ?? 0))} / ${formatBytes(Number(detail.usage?.stderrBytes ?? 0))}`} />
                  <Metric icon={<FileCheck2 size={16} />} label="Artifacts" value={String(detail.artifacts.length)} />
                  <Metric icon={<Box size={16} />} label="المحاولات" value={`${detail.attempts.current}/${detail.attempts.maximum}`} />
                </div>
                {detail.errorCode ? <p className="mt-3 rounded-lg border p-2 text-sm">{detail.errorCode} · المرجع {detail.errorReference?.slice(0, 8) ?? "—"}</p> : null}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <OutputPanel title="stdout" value={stdout} />
                <OutputPanel title="stderr" value={stderr} />
              </div>

              <div className="soft-card p-4">
                <h3 className="font-bold">Artifacts المثبتة</h3>
                <div className="mt-3 grid gap-2">
                  {detail.artifacts.length ? detail.artifacts.map((artifact) => (
                    <a key={artifact.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" href={artifact.downloadUrl}>
                      <span><strong>{artifact.filename}</strong><small className="block text-stone-500">{artifact.mediaType} · {formatBytes(artifact.sizeBytes)}</small></span>
                      <span className="font-mono text-[10px]">{artifact.sha256.slice(0, 12)}…</span>
                    </a>
                  )) : <p className="text-sm text-stone-500">لا يوجد Artifact؛ لا تعتبر العملية ناجحة قبل ظهوره في سيناريو النجاح.</p>}
                </div>
              </div>

              <div className="soft-card p-4">
                <h3 className="font-bold">الأحداث الحية</h3>
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto font-mono text-xs" aria-live="polite">
                  {events.map((event) => (
                    <div key={event.sequence} className="grid grid-cols-[3rem_10rem_minmax(0,1fr)] gap-2 rounded-lg border p-2">
                      <span>#{event.sequence}</span><span>{event.type}</span><span className="truncate">{JSON.stringify(event.payload)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : selected ? <p className="soft-card p-4 text-sm">اختر العملية لعرض سجلها.</p> : null}
        </section>
      </div>
    </main>
  );
}

function Metric(props: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl border p-3"><span className="flex items-center gap-2 text-xs text-stone-500">{props.icon}{props.label}</span><strong className="mt-1 block text-sm">{props.value}</strong></div>;
}

function OutputPanel(props: { title: string; value: string }) {
  return (
    <div className="soft-card overflow-hidden">
      <div className="border-b px-4 py-2 font-mono text-xs">{props.title}</div>
      <pre className="max-h-72 min-h-32 overflow-auto whitespace-pre-wrap break-words p-4 text-xs" dir="ltr">{props.value || "لا توجد مخرجات."}</pre>
    </div>
  );
}
