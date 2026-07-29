import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agents, providerCredentials, runs } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId) redirect("/select-organization");
  const organizationId = session.organizationId;
  const [agentCount, providerCount, runCount, recentRuns] = await Promise.all([
    db().select({ value: count() }).from(agents).where(eq(agents.organizationId, organizationId)),
    db().select({ value: count() }).from(providerCredentials).where(eq(providerCredentials.organizationId, organizationId)),
    db().select({ value: count() }).from(runs).where(eq(runs.organizationId, organizationId)),
    db().select({ id: runs.id, status: runs.status, model: runs.model, createdAt: runs.createdAt }).from(runs).where(eq(runs.organizationId, organizationId)).orderBy(desc(runs.createdAt)).limit(5),
  ]);
  const cards = [
    { label: "المزودون", value: providerCount[0]?.value ?? 0, href: "/dashboard/providers", hint: "فحص وحفظ النماذج" },
    { label: "الوكلاء", value: agentCount[0]?.value ?? 0, href: "/dashboard/agents", hint: "إنشاء ونشر الوكلاء" },
    { label: "عمليات التشغيل", value: runCount[0]?.value ?? 0, href: "/dashboard/runs", hint: "سجل الاستدعاءات الفعلي" },
  ];
  return <DashboardShell session={session} activePath="/dashboard" title={`مرحبًا ${session.name ?? session.email}`} description="لوحة تشغيل فعلية مرتبطة بقاعدة PostgreSQL والمزودات والوكلاء والمحادثات.">
    <section className="grid gap-4 sm:grid-cols-3">{cards.map((card) => <Link key={card.href} href={card.href} className="soft-card block p-5 transition hover:-translate-y-0.5 hover:border-emerald-200/30"><p className="text-sm text-stone-400">{card.label}</p><p className="mt-3 text-4xl font-black">{card.value}</p><p className="mt-2 text-xs text-stone-500">{card.hint}</p></Link>)}</section>
    <section className="mt-5 grid gap-4 md:grid-cols-3">
      <Link href="/dashboard/providers" className="soft-card p-5"><h2 className="font-bold text-emerald-100">1. اربط مزودًا</h2><p className="mt-2 text-sm leading-7 text-stone-400">أدخل API Key وBase URL، افحص الاتصال، ثم احفظ النماذج المشفرة.</p></Link>
      <Link href="/dashboard/agents" className="soft-card p-5"><h2 className="font-bold text-amber-100">2. أنشئ وكيلًا</h2><p className="mt-2 text-sm leading-7 text-stone-400">اختر نموذجًا مكتشفًا، أضف التعليمات، ثم انشر الوكيل.</p></Link>
      <Link href="/dashboard/chat" className="soft-card p-5"><h2 className="font-bold text-rose-100">3. ابدأ الدردشة</h2><p className="mt-2 text-sm leading-7 text-stone-400">كل رسالة تُحفظ وتُشغّل النموذج وتظهر في سجل التشغيل.</p></Link>
    </section>
    <section className="soft-card mt-5 p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">آخر عمليات التشغيل</h2><Link href="/dashboard/runs" className="text-sm text-emerald-100">عرض الكل</Link></div>{recentRuns.length === 0 ? <p className="mt-5 rounded-2xl border border-dashed border-stone-700 p-10 text-center text-sm text-stone-400">لا توجد عمليات تشغيل حتى الآن.</p> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead className="text-right text-stone-400"><tr><th className="pb-3">المعرّف</th><th className="pb-3">الحالة</th><th className="pb-3">النموذج</th><th className="pb-3">التاريخ</th></tr></thead><tbody className="divide-y divide-stone-800">{recentRuns.map((run) => <tr key={run.id}><td className="py-4 font-mono text-xs" dir="ltr">{run.id}</td><td className="py-4">{run.status}</td><td className="py-4 font-mono text-xs" dir="ltr">{run.model}</td><td className="py-4">{run.createdAt.toLocaleString("ar")}</td></tr>)}</tbody></table></div>}</section>
  </DashboardShell>;
}
