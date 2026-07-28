import { count, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { agents, providerCredentials, runs } from "@/db/schema";
import { LogoutButton } from "@/components/logout-button";
import { currentSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await currentSession();
  if (!session?.organizationId) redirect("/login");

  const organizationId = session.organizationId;
  const [agentCount, providerCount, runCount, recentRuns] = await Promise.all([
    db().select({ value: count() }).from(agents).where(eq(agents.organizationId, organizationId)),
    db().select({ value: count() }).from(providerCredentials).where(eq(providerCredentials.organizationId, organizationId)),
    db().select({ value: count() }).from(runs).where(eq(runs.organizationId, organizationId)),
    db().select({ id: runs.id, status: runs.status, model: runs.model, createdAt: runs.createdAt }).from(runs).where(eq(runs.organizationId, organizationId)).orderBy(desc(runs.createdAt)).limit(5),
  ]);

  const cards = [
    { label: "الوكلاء", value: agentCount[0]?.value ?? 0 },
    { label: "مزودو النماذج", value: providerCount[0]?.value ?? 0 },
    { label: "عمليات التشغيل", value: runCount[0]?.value ?? 0 },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-400">Moataz Agent Platform</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">لوحة تحكم {session.organizationName}</h1>
            <p className="mt-1 text-sm text-slate-400">مرحبًا {session.name ?? session.email} — صلاحيتك: {session.role}</p>
          </div>
          <LogoutButton />
        </header>

        <section className="grid gap-4 py-8 sm:grid-cols-3">
          {cards.map((card) => (
            <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg shadow-black/10">
              <p className="text-sm text-slate-400">{card.label}</p>
              <p className="mt-3 text-4xl font-bold">{card.value}</p>
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">آخر عمليات التشغيل</h2>
              <p className="mt-1 text-sm text-slate-400">بيانات فعلية معزولة حسب المؤسسة من PostgreSQL.</p>
            </div>
          </div>

          {recentRuns.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-400">لا توجد عمليات تشغيل حتى الآن.</div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-right text-slate-400"><tr><th className="pb-3">المعرّف</th><th className="pb-3">الحالة</th><th className="pb-3">النموذج</th><th className="pb-3">التاريخ</th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {recentRuns.map((run) => <tr key={run.id}><td className="py-4 font-mono text-xs" dir="ltr">{run.id}</td><td className="py-4">{run.status}</td><td className="py-4" dir="ltr">{run.model}</td><td className="py-4">{run.createdAt.toLocaleString("ar")}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="mt-10 border-t border-slate-800 pt-6 text-center text-sm text-slate-500">برمجة وتطوير معتز العلقمي</footer>
      </div>
    </main>
  );
}
