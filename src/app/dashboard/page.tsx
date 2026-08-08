import Link from "next/link";
import { Bot, MessageSquare, PlugZap, Plus, TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { buttonClass } from "@/components/ui";
import { currentSession } from "@/lib/auth/session";
import { loadDashboardSummary } from "@/lib/dashboard/summary";
import { friendlyModelName, relativeTime, runStatusPresentation } from "@/lib/ui/presentation";
import "./dashboard-workspace.css";

export default async function DashboardPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");

  const summary = await loadDashboardSummary({
    organizationId: session.organizationId,
    userId: session.userId,
    role: session.role,
  });
  const displayName = session.name?.trim().split(/\s+/)[0] || "مرحبًا";

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard"
      title={`مرحبًا ${displayName}`}
      description="ابدأ محادثة أو تابع ما يحتاج انتباهك دون ازدحام التفاصيل التشغيلية."
      actions={<Link className={buttonClass({ variant: "primary", size: "md" })} href="/dashboard/chat"><Plus size={16} /> محادثة جديدة</Link>}
    >
      <section className="workspace-metrics" aria-label="ملخص مساحة العمل">
        <Link href="/dashboard/agents?status=published" className="workspace-metric"><span className="workspace-metric-icon"><Bot size={18} /></span><div><strong>{new Intl.NumberFormat("ar").format(summary.activeAgents)}</strong><span>وكلاء منشورون</span></div></Link>
        <Link href="/dashboard/runs" className="workspace-metric"><span className="workspace-metric-icon"><MessageSquare size={18} /></span><div><strong>{new Intl.NumberFormat("ar").format(summary.runsToday)}</strong><span>تشغيلات اليوم</span></div></Link>
        <Link href="/dashboard/runs?status=failed" className="workspace-metric"><span className="workspace-metric-icon metric-danger"><TriangleAlert size={18} /></span><div><strong>{new Intl.NumberFormat("ar").format(summary.failedRuns)}</strong><span>فشلت اليوم</span></div></Link>
        <Link href="/dashboard/integrations" className="workspace-metric"><span className="workspace-metric-icon metric-warning"><PlugZap size={18} /></span><div><strong>{new Intl.NumberFormat("ar").format(summary.integrationsNeedingAttention)}</strong><span>تكاملات تحتاج تدخلًا</span></div></Link>
      </section>

      <div className="workspace-home-grid">
        <section className="page-section workspace-recent-section">
          <header className="page-section-header"><div><h2>متابعة العمل</h2><p>آخر المحادثات التي يمكنك الوصول إليها.</p></div><Link href="/dashboard/chat">عرض الكل</Link></header>
          <div className="workspace-recent-list">
            {summary.recentConversations.length ? summary.recentConversations.map((conversation) => <Link key={conversation.id} href={`/dashboard/chat?conversationId=${encodeURIComponent(conversation.id)}`} className="workspace-recent-row"><span className="workspace-row-avatar">{conversation.agentName.slice(0, 1)}</span><span className="workspace-row-copy"><b>{conversation.title?.trim() || "محادثة بدون عنوان"}</b><small>{conversation.summary?.trim() || conversation.agentName}</small></span><time>{relativeTime(conversation.lastMessageAt ?? conversation.updatedAt)}</time></Link>) : <div className="workspace-empty-inline"><MessageSquare size={18} /><p>لا توجد محادثات نشطة بعد.</p><Link href="/dashboard/chat">ابدأ أول محادثة</Link></div>}
          </div>
        </section>

        <section className="page-section workspace-recent-section">
          <header className="page-section-header"><div><h2>النشاط الأخير</h2><p>أحدث تشغيلات الوكلاء.</p></div><Link href="/dashboard/runs">كل التشغيلات</Link></header>
          <div className="workspace-run-list">
            {summary.recentRuns.length ? summary.recentRuns.map((run) => {
              const status = runStatusPresentation[run.status];
              return <Link key={run.id} href={`/dashboard/runs?runId=${encodeURIComponent(run.id)}`} className="workspace-run-row"><span className={`status-badge status-${status.tone}`}>{status.label}</span><span className="workspace-row-copy"><b>{run.agentName}</b><small>{friendlyModelName(run.model)}</small></span><time>{relativeTime(run.createdAt)}</time></Link>;
            }) : <div className="workspace-empty-inline"><Bot size={18} /><p>لا توجد تشغيلات بعد.</p><Link href="/dashboard/agents">افتح الوكلاء</Link></div>}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
