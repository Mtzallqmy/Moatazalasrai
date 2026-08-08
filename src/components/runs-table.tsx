"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, ChevronDown, Clock3, ExternalLink, RefreshCw, TerminalSquare } from "lucide-react";
import { Alert, Button, EmptyState } from "@/components/ui";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import { detailedDateTime, formatCompactNumber, formatDurationMs, friendlyModelName, relativeTime, runStatusPresentation } from "@/lib/ui/presentation";

type RunStatus = keyof typeof runStatusPresentation;
type Run = {
  id: string;
  requestId: string;
  agentName: string;
  status: RunStatus;
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

function durationMs(run: Run) {
  if (!run.startedAt) return null;
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  return Math.max(0, end - new Date(run.startedAt).getTime());
}

function safePayload(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([key]) => !/(token|secret|authorization|api.?key|password)/i.test(key))
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value.slice(0, 160) : JSON.stringify(value).slice(0, 160)}`);
}

function eventLabel(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("created") || normalized.includes("queued")) return "تم إنشاء التشغيل";
  if (normalized.includes("started") || normalized.includes("running")) return "بدأ التنفيذ";
  if (normalized.includes("tool")) return "استدعاء أداة";
  if (normalized.includes("approval")) return "بانتظار الموافقة";
  if (normalized.includes("completed")) return "اكتمل التشغيل";
  if (normalized.includes("failed") || normalized.includes("error")) return "فشل التنفيذ";
  if (normalized.includes("cancel")) return "أُلغي التشغيل";
  return "حدث تشغيلي";
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

  if (!runs.length) return <EmptyState icon={<Activity size={22} />} title="لا توجد تشغيلات" description="ستظهر هنا التشغيلات الحقيقية بعد تشغيل وكيل أو إرسال رسالة." />;

  return <div className="runs-workspace runs-workspace-v2">
    {error ? <Alert tone="danger">{error}</Alert> : null}
    <div className="run-compact-list">{runs.map((run) => {
      const expanded = open === run.id;
      const presentation = runStatusPresentation[run.status] ?? { label: run.status, tone: "muted" as const };
      const totalTokens = run.inputTokens !== null && run.outputTokens !== null ? run.inputTokens + run.outputTokens : null;
      return <article className={`run-list-item${expanded ? " is-expanded" : ""}`} key={run.id}>
        <div className="run-list-summary">
          <span className="run-agent-icon"><TerminalSquare size={18} /></span>
          <div className="run-list-copy">
            <div className="run-list-title"><h2>{run.agentName}</h2><span className={`status-badge status-${presentation.tone}`}>{presentation.label}</span></div>
            <p>{friendlyModelName(run.model)}</p>
            <div className="run-list-meta"><span><Clock3 size={13} /> {formatDurationMs(durationMs(run))}</span><span>{relativeTime(run.createdAt)}</span></div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { const next = expanded ? null : run.id; setOpen(next); if (next) void loadEvents(run.id); }} aria-expanded={expanded}><ChevronDown size={14} className={expanded ? "rotate-180" : undefined} /> التفاصيل</Button>
        </div>

        {expanded ? <section className="run-detail-panel" aria-label={`تفاصيل تشغيل ${run.agentName}`}>
          <div className="run-overview-grid">
            <div><span>الحالة</span><b>{presentation.label}</b></div>
            <div><span>المدة</span><b>{formatDurationMs(durationMs(run))}</b></div>
            <div><span>وقت الإنشاء</span><b>{detailedDateTime(run.createdAt)}</b></div>
            <div><span>الاستخدام</span><b>{totalTokens === null ? "غير متاح" : `${formatCompactNumber(totalTokens)} token`}</b></div>
          </div>
          {run.error ? <Alert tone="danger" title="فشل التشغيل">{run.error}</Alert> : null}
          <div className="run-detail-links">
            {run.conversationId ? <Link href={`/dashboard/chat?conversationId=${encodeURIComponent(run.conversationId)}`}>فتح المحادثة <ExternalLink size={13} /></Link> : null}
            <Button size="sm" variant="ghost" disabled={loading === run.id} onClick={() => void loadEvents(run.id, true)}><RefreshCw size={13} /> تحديث الأحداث</Button>
          </div>
          <details className="run-technical-details">
            <summary>التفاصيل التقنية</summary>
            <dl>
              <div><dt>Provider</dt><dd className="technical-value">{run.provider}</dd></div>
              <div><dt>Model</dt><dd className="technical-value">{run.model}</dd></div>
              <div><dt>Input tokens</dt><dd>{formatCompactNumber(run.inputTokens)}</dd></div>
              <div><dt>Output tokens</dt><dd>{formatCompactNumber(run.outputTokens)}</dd></div>
              <div><dt>Run ID</dt><dd className="technical-value">{run.id}</dd></div>
              <div><dt>Request ID</dt><dd className="technical-value">{run.requestId}</dd></div>
              {run.providerRequestId ? <div><dt>Provider request</dt><dd className="technical-value">{run.providerRequestId}</dd></div> : null}
              {run.errorCode ? <div><dt>Error code</dt><dd className="technical-value">{run.errorCode}</dd></div> : null}
            </dl>
          </details>
          <section className="run-event-panel" aria-label={`أحداث تشغيل ${run.agentName}`}>
            <h3>التسلسل الزمني</h3>
            {loading === run.id && !events[run.id] ? <p className="run-loading">جارٍ تحميل التسلسل…</p> : (events[run.id] ?? []).length ? <ol className="run-timeline">{events[run.id].map((event) => {
              const safe = safePayload(event.payload);
              return <li key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span className="run-timeline-dot" aria-hidden="true" /><div><h4>{eventLabel(event.type)}</h4><code className="technical-value">{event.type}</code>{safe.length ? <details><summary>بيانات الحدث</summary><pre dir="ltr">{safe.join("\n")}</pre></details> : null}</div></li>;
            })}</ol> : <p className="run-loading">لا توجد أحداث مسجلة لهذه العملية.</p>}
          </section>
        </section> : null}
      </article>;
    })}</div>
  </div>;
}
