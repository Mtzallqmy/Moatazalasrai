import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Clock3, MessageSquare, TerminalSquare } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agents, runs } from "@/db/schema";
import { getRunEvents } from "@/lib/agents/runtime";
import { currentSession } from "@/lib/auth/session";
import { requireConversationAccess } from "@/lib/chat/access";
import { detailedDateTime, formatCompactNumber, formatDurationMs, friendlyModelName, runStatusPresentation } from "@/lib/ui/presentation";
import "../runs-workspace.css";

function durationMs(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt) return null;
  return Math.max(0, (completedAt?.getTime() ?? Date.now()) - startedAt.getTime());
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

function safePayload(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([key]) => !/(token|secret|authorization|api.?key|password)/i.test(key))
    .slice(0, 10)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value.slice(0, 180) : JSON.stringify(value).slice(0, 180)}`);
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  const { id } = await params;
  const [run] = await db().select({
    id: runs.id,
    requestId: runs.requestId,
    conversationId: runs.conversationId,
    agentId: runs.agentId,
    agentName: agents.name,
    status: runs.status,
    provider: runs.provider,
    model: runs.model,
    inputTokens: runs.inputTokens,
    outputTokens: runs.outputTokens,
    providerRequestId: runs.providerRequestId,
    error: runs.error,
    errorCode: runs.errorCode,
    startedAt: runs.startedAt,
    completedAt: runs.completedAt,
    createdAt: runs.createdAt,
  }).from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(and(eq(runs.id, id), eq(runs.organizationId, session.organizationId)))
    .limit(1);
  if (!run || !run.conversationId) notFound();

  await requireConversationAccess({
    organizationId: session.organizationId,
    conversationId: run.conversationId,
    userId: session.userId,
    role: session.role,
    access: "read",
    includeArchived: true,
  });
  const events = await getRunEvents(session.organizationId, run.id);
  const status = runStatusPresentation[run.status];
  const totalTokens = run.inputTokens !== null && run.outputTokens !== null ? run.inputTokens + run.outputTokens : null;

  return <DashboardShell session={session} activePath="/dashboard/runs" title={`تشغيل ${run.agentName}`} description={`${status.label} · ${friendlyModelName(run.model)}`} actions={<Link href="/dashboard/runs" className="secondary-button"><ArrowRight size={15} /> العودة للتشغيلات</Link>}>
    <div className="run-detail-page">
      <section className="run-detail-hero">
        <div className="run-detail-heading"><span className="run-agent-icon"><TerminalSquare size={19} /></span><div><h2>{run.agentName}</h2><p>{friendlyModelName(run.model)}</p></div><span className={`status-badge status-${status.tone}`}>{status.label}</span></div>
        <div className="run-overview-grid">
          <div><span>المدة</span><b>{formatDurationMs(durationMs(run.startedAt, run.completedAt))}</b></div>
          <div><span>وقت الإنشاء</span><b>{detailedDateTime(run.createdAt)}</b></div>
          <div><span>إجمالي Tokens</span><b>{formatCompactNumber(totalTokens)}</b></div>
          <div><span>الحالة</span><b>{status.label}</b></div>
        </div>
        <div className="run-detail-links"><Link href={`/dashboard/chat?conversationId=${encodeURIComponent(run.conversationId)}`}><MessageSquare size={14} /> فتح المحادثة</Link></div>
      </section>

      {run.error ? <section className="run-error-section"><h3>الخطأ</h3><p>{run.error}</p>{run.errorCode ? <code className="technical-value">{run.errorCode}</code> : null}</section> : null}

      <section className="page-section run-detail-timeline-section">
        <header className="page-section-header"><div><h2>التسلسل الزمني</h2><p>الأحداث المسجلة بالترتيب الزمني.</p></div><Clock3 size={18} /></header>
        <div className="page-section-body">{events.length ? <ol className="run-timeline">{events.map((event) => {
          const safe = safePayload(event.payload);
          return <li key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span className="run-timeline-dot" aria-hidden="true" /><div><h4>{eventLabel(event.type)}</h4><code className="technical-value">{event.type}</code>{safe.length ? <details><summary>بيانات الحدث</summary><pre dir="ltr">{safe.join("\n")}</pre></details> : null}</div></li>;
        })}</ol> : <p className="run-loading">لا توجد أحداث مسجلة لهذه العملية.</p>}</div>
      </section>

      <section className="page-section run-detail-technical-section">
        <header className="page-section-header"><div><h2>الاستخدام والتفاصيل التقنية</h2><p>معلومات للمطور أو التشخيص عند الحاجة.</p></div></header>
        <dl className="run-technical-grid">
          <div><dt>Provider</dt><dd className="technical-value">{run.provider}</dd></div>
          <div><dt>Model</dt><dd className="technical-value">{run.model}</dd></div>
          <div><dt>Input tokens</dt><dd>{formatCompactNumber(run.inputTokens)}</dd></div>
          <div><dt>Output tokens</dt><dd>{formatCompactNumber(run.outputTokens)}</dd></div>
          <div><dt>Run ID</dt><dd className="technical-value">{run.id}</dd></div>
          <div><dt>Request ID</dt><dd className="technical-value">{run.requestId}</dd></div>
          {run.providerRequestId ? <div><dt>Provider request</dt><dd className="technical-value">{run.providerRequestId}</dd></div> : null}
        </dl>
      </section>
    </div>
  </DashboardShell>;
}
