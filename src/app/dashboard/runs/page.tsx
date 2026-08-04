import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { buttonClass } from "@/components/ui";
import { RunsTable } from "@/components/runs-table";
import { listOrganizationRuns } from "@/lib/agents/runtime";
import { currentSession } from "@/lib/auth/session";

const statuses = ["all", "queued", "running", "completed", "failed", "cancelled"] as const;

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId) redirect("/select-organization");
  const params = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));
  const status = statuses.includes(params.status as (typeof statuses)[number]) ? params.status as (typeof statuses)[number] : "all";
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
  return (
    <DashboardShell session={session} activePath="/dashboard/runs" title="عمليات التشغيل" description="دورة حياة فعلية، استهلاك متاح دون اختلاق، ومعرّفات طلب وأحداث منقحة.">
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="تصفية الحالة">
        {statuses.map((item) => <Link key={item} className={buttonClass({ variant: status === item ? "primary" : "secondary", size: "sm" })} href={`/dashboard/runs?status=${item}`}>{item}</Link>)}
      </nav>
      <RunsTable runs={result.rows.map((run) => ({
        ...run,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
      }))} />
      <nav className="mt-4 flex items-center justify-between text-sm"><Link aria-disabled={page <= 1} className={`${buttonClass({ variant: "secondary", size: "sm" })} aria-disabled:pointer-events-none aria-disabled:opacity-40`} href={`/dashboard/runs?status=${status}&page=${page - 1}`}>السابق</Link><span>{page} / {pages}</span><Link aria-disabled={page >= pages} className={`${buttonClass({ variant: "secondary", size: "sm" })} aria-disabled:pointer-events-none aria-disabled:opacity-40`} href={`/dashboard/runs?status=${status}&page=${page + 1}`}>التالي</Link></nav>
    </DashboardShell>
  );
}
