import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { db } from "@/db";
import { agents, runs } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function RunsPage() {
  const session = await currentSession();
  if (!session?.organizationId) redirect("/login");
  const rows = await db().select({ id: runs.id, agentName: agents.name, status: runs.status, provider: runs.provider, model: runs.model, input: runs.input, output: runs.output, error: runs.error, inputTokens: runs.inputTokens, outputTokens: runs.outputTokens, createdAt: runs.createdAt }).from(runs).innerJoin(agents, eq(agents.id, runs.agentId)).where(eq(runs.organizationId, session.organizationId)).orderBy(desc(runs.createdAt)).limit(100);
  return <DashboardShell session={session} activePath="/dashboard/runs" title="عمليات التشغيل" description="سجل حقيقي لكل استدعاء نموذج، مع الحالة والرموز والمخرجات المنقحة."><section className="soft-card overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-stone-900/70 text-right text-stone-400"><tr><th className="p-4">الوكيل</th><th className="p-4">الحالة</th><th className="p-4">المزود/النموذج</th><th className="p-4">الرموز</th><th className="p-4">الوقت</th></tr></thead><tbody className="divide-y divide-stone-800">{rows.map((row) => <tr key={row.id}><td className="p-4"><p className="font-semibold">{row.agentName}</p><details className="mt-2 text-xs text-stone-400"><summary className="cursor-pointer">المدخل والمخرج</summary><pre className="mt-2 max-w-xl whitespace-pre-wrap">{row.input}</pre><pre className="mt-2 max-w-xl whitespace-pre-wrap text-emerald-100">{row.output || row.error || "لا توجد نتيجة"}</pre></details></td><td className="p-4">{row.status}</td><td className="p-4 font-mono text-xs" dir="ltr">{row.provider}<br />{row.model}</td><td className="p-4" dir="ltr">{row.inputTokens} / {row.outputTokens}</td><td className="p-4">{row.createdAt.toLocaleString("ar")}</td></tr>)}</tbody></table></div>{rows.length === 0 ? <p className="p-10 text-center text-sm text-stone-400">لا توجد عمليات تشغيل بعد.</p> : null}</section></DashboardShell>;
}
