"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, ChevronDown, Clock3, ExternalLink, RefreshCw, TerminalSquare } from "lucide-react";
import { Alert, Button, EmptyState, StatusBadge } from "@/components/ui";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";

type Run = {
  id: string;
  requestId: string;
  agentName: string;
  status: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
  error: string | null;
  errorCode: string | null;
  conversationId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};
type Event = { id: string; sequence: number; type: string; payload: Record<string, unknown>; createdAt: string };

function duration(run: Run) {
  if (!run.startedAt) return "لم يبدأ";
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const milliseconds = Math.max(0, end - new Date(run.startedAt).getTime());
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function safePayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).filter(([key]) => !/(token|secret|authorization|api.?key|password)/i.test(key));
  return entries.slice(0, 8).map(([key, value]) => `${key}: ${typeof value === "string" ? value.slice(0, 160) : JSON.stringify(value).slice(0, 160)}`);
}

export function RunsTable({ runs }: { runs: Run[] }) {
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents(runId: string, force = false) {
    if (events[runId] && !force) return;
    setLoading(runId);
    setError(null);
    try {
      const rows = await apiRequest<Event[]>(`/api/dashboard/runs?runId=${encodeURIComponent(runId)}`);
      setEvents((current) => ({ ...current, [runId]: rows }));
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر تحميل أحداث التشغيل."));
    } finally {
      setLoading(null);
    }
  }

  if (!runs.length) return <EmptyState icon={<Activity size={22} />} title="لا توجد عمليات تشغيل" description="ستظهر هنا العمليات الحقيقية بعد تشغيل وكيل أو إرسال رسالة." />;

  return <div className="runs-workspace">
    {error ? <Alert tone="danger">{error}</Alert> : null}
    <div className="run-card-list">{runs.map((run) => {
      const expanded = open === run.id;
      return <article className="run-card" key={run.id}>
        <header>
          <span className="run-agent-icon"><TerminalSquare size={18} /></span>
          <div className="min-w-0"><h2>{run.agentName}</h2><p><bdi dir="ltr">{run.provider} / {run.model}</bdi></p></div>
          <StatusBadge status={run.status} label={run.status === "completed" ? "مكتمل" : run.status === "running" ? "قيد التشغيل" : run.status === "queued" ? "في الطابور" : run.status === "failed" ? "فشل" : run.status === "cancelled" ? "ملغي" : run.status} />
        </header>
        <div className="run-metrics">
          <div><span>المدة</span><strong><Clock3 size={13} /> {duration(run)}</strong></div>
          <div><span>Tokens</span><strong dir="ltr">{run.inputTokens ?? "—"} / {run.outputTokens ?? "—"}</strong></div>
          <div><span>وقت البدء</span><strong>{new Date(run.createdAt).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}</strong></div>
        </div>
        {run.error ? <Alert tone="danger" title={run.errorCode ?? "RUN_FAILED"}>{run.error}</Alert> : null}
        <footer>
          {run.conversationId ? <Link href={`/dashboard/chat?conversationId=${encodeURIComponent(run.conversationId)}`}>فتح المحادثة <ExternalLink size={13} /></Link> : <span />}
          <Button variant="ghost" size="sm" onClick={() => { const next = expanded ? null : run.id; setOpen(next); if (next) void loadEvents(run.id); }} aria-expanded={expanded}><ChevronDown size={14} className={expanded ? "rotate-180" : undefined} /> الأحداث</Button>
        </footer>
        {expanded ? <section className="run-event-panel" aria-label={`أحداث تشغيل ${run.agentName}`}>
          <div className="run-identifiers"><span><b>request</b><bdi dir="ltr">{run.requestId}</bdi></span><span><b>provider request</b><bdi dir="ltr">{run.providerRequestId ?? "N/A"}</bdi></span><Button size="sm" variant="ghost" disabled={loading === run.id} onClick={() => void loadEvents(run.id, true)}><RefreshCw size={13} /> تحديث</Button></div>
          {loading === run.id && !events[run.id] ? <p className="run-loading">جارٍ تحميل التسلسل…</p> : (events[run.id] ?? []).length ? <ol className="run-timeline">{events[run.id].map((event) => <li key={event.id}><span>{event.sequence}</span><div><h3 dir="ltr">{event.type}</h3><time>{new Date(event.createdAt).toLocaleString("ar")}</time>{safePayload(event.payload).length ? <details><summary>المدخلات والنتائج الآمنة</summary><pre dir="ltr">{safePayload(event.payload).join("\n")}</pre></details> : null}</div></li>)}</ol> : <p className="run-loading">لا توجد أحداث مسجلة لهذه العملية.</p>}
        </section> : null}
      </article>;
    })}</div>
  </div>;
}
