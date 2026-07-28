import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { agents, providerCredentials, runs } from "@/db/schema";
import { LogoutButton } from "@/components/logout-button";
import { currentSession } from "@/lib/auth/session";
import { platformIdentity } from "@/lib/platform/identity";

const navigation = [
  { label: "نظرة عامة", href: "/dashboard" },
  { label: "المزودون", href: "/dashboard/providers" },
  { label: "الوكلاء", href: "/dashboard/agents" },
  { label: "عمليات التشغيل", href: "/dashboard/runs" },
  { label: "التشخيص", href: "/dashboard/diagnostics" },
];

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
    { label: "الوكلاء", value: agentCount[0]?.value ?? 0, hint: "وكلاء المؤسسة" },
    { label: "مزودو النماذج", value: providerCount[0]?.value ?? 0, hint: "مفاتيح مشفرة" },
    { label: "عمليات التشغيل", value: runCount[0]?.value ?? 0, hint: "سجل فعلي" },
  ];

  return (
    <main className="app-shell">
      <div className="mx-auto grid min-h-screen max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[250px_1fr] lg:px-6">
        <aside className="glass-panel rounded-3xl p-4 lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)]">
          <div className="border-b border-stone-700/70 px-2 pb-5">
            <p className="font-latin text-sm font-bold tracking-wide text-emerald-100" dir="ltr">{platformIdentity.productName}</p>
            <p className="mt-2 text-xs leading-5 text-stone-400">{session.organizationName}</p>
          </div>
          <nav className="mt-5 grid grid-cols-2 gap-2 text-sm lg:grid-cols-1">
            {navigation.map((item, index) => (
              <Link key={item.href} href={item.href} className={`rounded-2xl px-4 py-3 transition ${index === 0 ? "bg-emerald-100 text-emerald-950" : "text-stone-300 hover:bg-stone-800/80 hover:text-white"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 border-t border-stone-700/70 pt-5 lg:absolute lg:bottom-4 lg:left-4 lg:right-4">
            <p className="mb-3 truncate px-2 text-xs text-stone-400">{session.name ?? session.email}</p>
            <LogoutButton />
          </div>
        </aside>

        <section className="min-w-0">
          <header className="glass-panel rounded-3xl p-5 sm:p-7">
            <p className="text-sm font-semibold text-emerald-100">لوحة التحكم المؤسسية</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-black text-stone-50 sm:text-3xl">مرحبًا {session.name ?? session.email}</h1>
                <p className="mt-2 text-sm text-stone-400">بيانات حقيقية من PostgreSQL — الصلاحية الحالية: {session.role}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link className="secondary-button px-4 py-2 text-sm" href="/api/ready">فحص الجاهزية</Link>
                {session.role === "owner" || session.role === "admin" ? <Link className="primary-button px-4 py-2 text-sm" href="/dashboard/diagnostics">مركز التشخيص</Link> : null}
              </div>
            </div>
          </header>

          <section className="grid gap-4 py-5 sm:grid-cols-3">
            {cards.map((card, index) => (
              <article key={card.label} className="soft-card p-5">
                <div className={`mb-5 h-1.5 w-12 rounded-full ${index === 0 ? "bg-emerald-200/70" : index === 1 ? "bg-amber-100/60" : "bg-rose-200/50"}`} />
                <p className="text-sm text-stone-400">{card.label}</p>
                <p className="mt-3 text-4xl font-black text-stone-50">{card.value}</p>
                <p className="mt-2 text-xs text-stone-500">{card.hint}</p>
              </article>
            ))}
          </section>

          <section className="soft-card p-5 sm:p-6">
            <div>
              <h2 className="text-lg font-bold text-stone-100">آخر عمليات التشغيل</h2>
              <p className="mt-1 text-sm text-stone-400">استعلامات معزولة حسب المؤسسة، دون بيانات تجريبية.</p>
            </div>

            {recentRuns.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-stone-700 px-4 py-12 text-center text-sm text-stone-400">لا توجد عمليات تشغيل حتى الآن.</div>
            ) : (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="text-right text-stone-400"><tr><th className="pb-3">المعرّف</th><th className="pb-3">الحالة</th><th className="pb-3">النموذج</th><th className="pb-3">التاريخ</th></tr></thead>
                  <tbody className="divide-y divide-stone-800">
                    {recentRuns.map((run) => <tr key={run.id}><td className="py-4 font-mono text-xs" dir="ltr">{run.id}</td><td className="py-4">{run.status}</td><td className="py-4" dir="ltr">{run.model}</td><td className="py-4">{run.createdAt.toLocaleString("ar")}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="mt-8 border-t border-stone-700/70 py-6 text-center text-sm text-stone-500">{platformIdentity.ownerRole}: {platformIdentity.ownerName}</footer>
        </section>
      </div>
    </main>
  );
}
