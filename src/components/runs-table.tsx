"use client";

import Link from "next/link";
import { useState } from "react";

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
  if (!run.completedAt) return "قيد التشغيل";
  return `${Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())}ms`;
}

export function RunsTable({ runs }: { runs: Run[] }) {
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents(runId: string) {
    if (events[runId]) return;
    setLoading(runId);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/runs?runId=${encodeURIComponent(runId)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تحميل الأحداث.");
      setEvents((current) => ({ ...current, [runId]: payload.data }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الأحداث.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="soft-card overflow-hidden">
      {error ? <p role="alert" className="m-4 text-sm text-rose-100">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] text-sm">
          <thead className="bg-stone-900/70 text-right text-stone-400"><tr><th className="p-4">الوكيل</th><th className="p-4">الحالة</th><th className="p-4">المزود/النموذج</th><th className="p-4">Tokens</th><th className="p-4">المدة</th><th className="p-4">التشخيص</th></tr></thead>
          <tbody className="divide-y divide-stone-800">
            {runs.map((run) => (
              <tr key={run.id} className="align-top">
                <td className="p-4"><strong>{run.agentName}</strong><span className="mt-1 block font-mono text-xs text-stone-500" dir="ltr">{run.id}</span>{run.conversationId ? <Link className="mt-2 block text-xs text-emerald-100" href={`/dashboard/chat?conversationId=${run.conversationId}`}>المحادثة المرتبطة</Link> : null}</td>
                <td className="p-4"><span className={`status-badge ${run.status === "completed" ? "status-success" : run.status === "failed" || run.status === "cancelled" ? "status-error" : "status-neutral"}`}>{run.status}</span>{run.error ? <p className="mt-2 max-w-xs text-xs text-rose-100">{run.errorCode}: {run.error}</p> : null}</td>
                <td className="p-4 font-mono text-xs" dir="ltr">{run.provider}<br />{run.model}</td>
                <td className="p-4" dir="ltr">{run.inputTokens ?? "N/A"} / {run.outputTokens ?? "N/A"}</td>
                <td className="p-4">{duration(run)}<span className="mt-1 block text-xs text-stone-500">{new Date(run.createdAt).toLocaleString("ar")}</span></td>
                <td className="p-4">
                  <span className="block max-w-[220px] truncate font-mono text-xs text-stone-500" dir="ltr">request: {run.requestId}</span>
                  <span className="mt-1 block max-w-[220px] truncate font-mono text-xs text-stone-500" dir="ltr">provider: {run.providerRequestId ?? "N/A"}</span>
                  <details className="mt-3" onToggle={(event) => { if (event.currentTarget.open) loadEvents(run.id); }}>
                    <summary className="cursor-pointer text-emerald-100">تسلسل الأحداث</summary>
                    <ol className="mt-3 space-y-2 border-r border-stone-700 pr-3">
                      {(events[run.id] ?? []).map((event) => <li key={event.id}><strong className="font-mono text-xs" dir="ltr">{event.sequence}. {event.type}</strong><span className="mt-1 block text-xs text-stone-500">{new Date(event.createdAt).toLocaleString("ar")}</span></li>)}
                      {loading === run.id ? <li className="text-xs text-stone-500">جارٍ التحميل...</li> : null}
                    </ol>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runs.length === 0 ? <p className="p-10 text-center text-sm text-stone-400">لا توجد عمليات تشغيل مطابقة.</p> : null}
    </section>
  );
}
