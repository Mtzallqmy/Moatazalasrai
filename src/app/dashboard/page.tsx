import { and, count, desc, eq } from "drizzle-orm";
import { Activity, Bot, Braces, FileText, MessageSquare, PlayCircle, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agentTeams, agents, conversations, mcpServers, providerCredentials, runs } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";
import { conversationAccessFilter } from "@/lib/chat/access";

function statusLabel(status: string) {
  return ({
    queued: "في الانتظار",
    running: "يعمل الآن",
    completed: "مكتمل",
    failed: "فشل",
    cancelled: "ملغي",
  } as Record<string, string>)[status] ?? status;
}

export default async function DashboardPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  const organizationId = session.organizationId;
  const isMember = session.role === "member";

  const [agentCount, providerCount, runCount, teamCount, mcpCount, recentRuns] = await Promise.all([
    db().select({ value: count() }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.status, "published"))),
    db().select({ value: count() }).from(providerCredentials).where(and(eq(providerCredentials.organizationId, organizationId), eq(providerCredentials.enabled, true), eq(providerCredentials.validationStatus, "verified"))),
    isMember
      ? db().select({ value: count() }).from(runs)
        .innerJoin(conversations, eq(conversations.id, runs.conversationId))
        .where(and(
          eq(runs.organizationId, organizationId),
          conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
        ))
      : db().select({ value: count() }).from(runs).where(eq(runs.organizationId, organizationId)),
    db().select({ value: count() }).from(agentTeams).where(eq(agentTeams.organizationId, organizationId)),
    db().select({ value: count() }).from(mcpServers).where(and(eq(mcpServers.organizationId, organizationId), eq(mcpServers.status, "connected"))),
    isMember
      ? db().select({
        id: runs.id,
        status: runs.status,
        model: runs.model,
        createdAt: runs.createdAt,
        agentName: agents.name,
      }).from(runs)
        .innerJoin(agents, eq(agents.id, runs.agentId))
        .innerJoin(conversations, eq(conversations.id, runs.conversationId))
        .where(and(
          eq(runs.organizationId, organizationId),
          conversationAccessFilter({ role: session.role, userId: session.userId, access: "read" }),
        ))
        .orderBy(desc(runs.createdAt)).limit(6)
      : db().select({
        id: runs.id,
        status: runs.status,
        model: runs.model,
        createdAt: runs.createdAt,
        agentName: agents.name,
      }).from(runs)
        .innerJoin(agents, eq(agents.id, runs.agentId))
        .where(eq(runs.organizationId, organizationId))
        .orderBy(desc(runs.createdAt)).limit(6),
  ]);

  const metrics = [
    { label: "الوكلاء النشطون", value: agentCount[0]?.value ?? 0, hint: "وكلاء جاهزون للتشغيل", icon: Bot },
    { label: "إجمالي التشغيلات", value: runCount[0]?.value ?? 0, hint: "سجل تنفيذي قابل للتدقيق", icon: PlayCircle },
    { label: "فرق الوكلاء", value: teamCount[0]?.value ?? 0, hint: "تنسيق متعدد الوكلاء", icon: Workflow },
    {
      label: isMember ? "الخدمات المتصلة" : "MCP / المزودون",
      value: isMember ? providerCount[0]?.value ?? 0 : `${mcpCount[0]?.value ?? 0} / ${providerCount[0]?.value ?? 0}`,
      hint: "اتصالات متحققة ومفعلة",
      icon: Braces,
    },
  ];

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard"
      title={`مرحباً ${session.name ?? "بك"}`}
      description="حوّل أهدافك إلى تشغيلات ووكلاء وفرق عمل مترابطة، وراقب التنفيذ من لوحة واحدة."
    >
      <dl className="metric-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div className="metric-card" key={metric.label}>
              <span className="metric-icon"><Icon size={18} aria-hidden="true" /></span>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
              <p className="metric-trend">{metric.hint}</p>
            </div>
          );
        })}
      </dl>

      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <div className="panel-header">
            <div>
              <h2>آخر عمليات التشغيل</h2>
              <p>أحدث السجلات المحفوظة في قاعدة البيانات</p>
            </div>
            <Link className="panel-link" href="/dashboard/runs">عرض الكل</Link>
          </div>
          {recentRuns.length === 0 ? (
            <div className="empty-state">
              <Activity size={26} aria-hidden="true" className="mx-auto mb-3" />
              لم تبدأ أي عملية بعد. ابدأ محادثة أو شغّل فريقاً.
            </div>
          ) : (
            <ul className="run-list">
              {recentRuns.map((run) => (
                <li className="run-row" key={run.id}>
                  <div className="min-w-0">
                    <Link className="run-title" href="/dashboard/runs">{run.agentName}</Link>
                    <div className="run-meta">
                      <bdi dir="ltr">{run.model}</bdi>
                      <span>{run.createdAt.toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</span>
                      <bdi dir="ltr">{run.id.slice(0, 8)}</bdi>
                    </div>
                  </div>
                  <span className={`status-chip status-${run.status}`}>{statusLabel(run.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="dashboard-panel">
          <div className="panel-header">
            <div>
              <h2>بدء سريع</h2>
              <p>أقصر طريق من الفكرة إلى التنفيذ</p>
            </div>
            <Plus size={18} aria-hidden="true" />
          </div>
          <div className="quick-actions">
            <Link className="quick-action" href="/dashboard/chat">
              <MessageSquare size={19} aria-hidden="true" />
              <span><b>محادثة جديدة</b><span>ابدأ مهمة مع وكيل منشور</span></span>
            </Link>
            <Link className="quick-action" href="/dashboard/agents">
              <Bot size={19} aria-hidden="true" />
              <span><b>إنشاء وكيل</b><span>تعليمات ونموذج وأدوات محددة</span></span>
            </Link>
            {!isMember ? (
              <>
                <Link className="quick-action" href="/dashboard/teams">
                  <Workflow size={19} aria-hidden="true" />
                  <span><b>تكوين فريق</b><span>مشرف وعدة وكلاء متخصصين</span></span>
                </Link>
                <Link className="quick-action" href="/dashboard/mcp">
                  <Braces size={19} aria-hidden="true" />
                  <span><b>ربط MCP</b><span>اكتشاف وتشغيل أدوات بعيدة</span></span>
                </Link>
              </>
            ) : (
              <Link className="quick-action" href="/dashboard/files">
                <FileText size={19} aria-hidden="true" />
                <span><b>رفع ملف</b><span>استخدم الملفات داخل محادثاتك</span></span>
              </Link>
            )}
          </div>
        </aside>
      </div>
    </DashboardShell>
  );
}
