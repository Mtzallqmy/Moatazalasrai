import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin"].includes(session.role)) redirect("/forbidden");
  const params = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));
  const limit = 50;
  const where = eq(auditLogs.organizationId, session.organizationId);
  const [rows, totals] = await Promise.all([
    db().select({
      id: auditLogs.id,
      actorType: auditLogs.actorType,
      actorId: auditLogs.actorId,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset((page - 1) * limit),
    db().select({ value: count() }).from(auditLogs).where(where),
  ]);
  const pages = Math.max(1, Math.ceil((totals[0]?.value ?? 0) / limit));
  return (
    <DashboardShell session={session} activePath="/dashboard/audit" title="سجل التدقيق" description="الإجراءات الحساسة فقط، دون مفاتيح أو كلمات مرور أو محتوى محادثات.">
      <section className="soft-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-stone-900/70 text-right text-stone-400"><tr><th className="p-4">الإجراء</th><th className="p-4">الفاعل</th><th className="p-4">المورد</th><th className="p-4">التاريخ</th></tr></thead>
            <tbody className="divide-y divide-stone-800">
              {rows.map((row) => <tr key={row.id}><td className="p-4 font-mono text-xs" dir="ltr">{row.action}</td><td className="p-4">{row.actorType}<span className="block font-mono text-xs text-stone-500" dir="ltr">{row.actorId ?? "—"}</span></td><td className="p-4">{row.resourceType}<span className="block font-mono text-xs text-stone-500" dir="ltr">{row.resourceId ?? "—"}</span></td><td className="p-4">{row.createdAt.toLocaleString("ar")}</td></tr>)}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="p-10 text-center text-stone-500">لا توجد أحداث تدقيق بعد.</p> : null}
      </section>
      <nav className="mt-4 flex items-center justify-between text-sm"><Link aria-disabled={page <= 1} className="secondary-button px-4 py-2 aria-disabled:pointer-events-none aria-disabled:opacity-40" href={`/dashboard/audit?page=${page - 1}`}>السابق</Link><span>{page} / {pages}</span><Link aria-disabled={page >= pages} className="secondary-button px-4 py-2 aria-disabled:pointer-events-none aria-disabled:opacity-40" href={`/dashboard/audit?page=${page + 1}`}>التالي</Link></nav>
    </DashboardShell>
  );
}
