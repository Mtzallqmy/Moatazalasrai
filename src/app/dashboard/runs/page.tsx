import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { buttonClass } from "@/components/ui";
import { RunsTable } from "@/components/runs-table";
import { listOrganizationRuns } from "@/lib/agents/runtime";
import { currentSession } from "@/lib/auth/session";
import { runStatusPresentation } from "@/lib/ui/presentation";
import "./runs-workspace.css";

const statuses = ["all", "queued", "running", "waiting_approval", "completed", "failed", "cancelled"] as const;
type Status = (typeof statuses)[number];

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId) redirect("/select-organization");
  const params = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));
  const status: Status = statuses.includes(params.status as Status) ? params.status as Status : "all";
  const limit = 25;
  const result = await listOrganizationRuns({
    organizationId: session.organizationId,
    userId: session.userId,
    role: session.role,
    page,
    limit,
    status: status === "all" ? undefined : status,
  });
  const pages = Math.max(1, Math.ceil(result.total / limit));
  const statusLabel = status === "all" ? "الكل" : runStatusPresentation[status].label;
  return (
    <DashboardShell session={session} activePath="/dashboard/runs" title="التشغيلات" description="تابع حالة التنفيذ والزمن، وافتح الأحداث والتفاصيل التقنية فقط عند الحاجة.">
      <div className="runs-toolbar">
        <div><b>{new Intl.NumberFormat("ar").format(result.total)}</b><span>تشغيل مطابق</span></div>
        <form method="get" className="run-filter-form">
          <label htmlFor="run-status">الحالة</label>
          <select id="run-status" name="status" defaultValue={status}>
            <option value="all">الكل</option>
            {Object.entries(runStatusPresentation).map(([value, presentation]) => <option key={value} value={value}>{presentation.label}</option>)}
          </select>
          <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>تطبيق</button>
        </form>
      </div>
      <p className="run-filter-summary">العرض الحالي: <strong>{statusLabel}</strong></p>
      <RunsTable runs={result.rows.map((run) => ({
        ...run,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
      }))} />
      <nav className="run-pagination" aria-label="صفحات التشغيلات">
        <Link aria-disabled={page <= 1} className={`${buttonClass({ variant: "secondary", size: "sm" })} aria-disabled:pointer-events-none aria-disabled:opacity-40`} href={`/dashboard/runs?status=${status}&page=${Math.max(1, page - 1)}`}>السابق</Link>
        <span>صفحة {new Intl.NumberFormat("ar").format(page)} من {new Intl.NumberFormat("ar").format(pages)}</span>
        <Link aria-disabled={page >= pages} className={`${buttonClass({ variant: "secondary", size: "sm" })} aria-disabled:pointer-events-none aria-disabled:opacity-40`} href={`/dashboard/runs?status=${status}&page=${Math.min(pages, page + 1)}`}>التالي</Link>
      </nav>
    </DashboardShell>
  );
}
