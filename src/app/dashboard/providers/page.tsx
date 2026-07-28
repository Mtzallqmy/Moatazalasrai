import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ProviderForm } from "@/components/provider-form";
import { db } from "@/db";
import { providerCredentials } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function ProvidersPage() {
  const session = await currentSession();
  if (!session?.organizationId) redirect("/login");
  const rows = await db().select({
    id: providerCredentials.id,
    provider: providerCredentials.provider,
    name: providerCredentials.name,
    baseUrl: providerCredentials.baseUrl,
    secretHint: providerCredentials.secretHint,
    discoveredModels: providerCredentials.discoveredModels,
    validationStatus: providerCredentials.validationStatus,
    lastValidatedAt: providerCredentials.lastValidatedAt,
    enabled: providerCredentials.enabled,
    createdAt: providerCredentials.createdAt,
  }).from(providerCredentials).where(eq(providerCredentials.organizationId, session.organizationId)).orderBy(desc(providerCredentials.createdAt));

  return <DashboardShell session={session} activePath="/dashboard/providers" title="المزودون والنماذج" description="فحص API Key وBase URL فعليًا، جلب النماذج من المزود، ثم حفظ المفتاح مشفرًا.">
    <ProviderForm />
    <section className="soft-card mt-5 p-5 sm:p-6">
      <h2 className="text-lg font-bold">الاتصالات المحفوظة</h2>
      {rows.length === 0 ? <p className="mt-5 rounded-2xl border border-dashed border-stone-700 p-10 text-center text-sm text-stone-400">لم تتم إضافة مزود بعد.</p> : <div className="mt-5 grid gap-3 lg:grid-cols-2">{rows.map((row) => <article key={row.id} className="rounded-2xl border border-stone-700/70 bg-stone-950/45 p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-latin text-xs uppercase tracking-wider text-emerald-100" dir="ltr">{row.provider}</p><h3 className="mt-1 font-bold">{row.name}</h3></div><span className={`rounded-full px-2.5 py-1 text-xs ${row.enabled && row.validationStatus === "verified" ? "bg-emerald-100/10 text-emerald-100" : "bg-rose-100/10 text-rose-100"}`}>{row.enabled && row.validationStatus === "verified" ? "مفعّل ومتحقق" : row.validationStatus}</span></div><p className="mt-4 break-all font-mono text-xs text-stone-400" dir="ltr">{row.baseUrl}</p><p className="mt-2 font-mono text-sm" dir="ltr">{row.secretHint}</p><details className="mt-4 rounded-2xl border border-stone-700 bg-stone-950/60 p-3"><summary className="cursor-pointer text-sm font-semibold text-emerald-100">النماذج المحفوظة ({row.discoveredModels.length})</summary><div className="mt-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto" dir="ltr">{row.discoveredModels.map((model) => <span key={model} className="rounded-full border border-stone-700 px-2.5 py-1 font-mono text-xs text-stone-300">{model}</span>)}</div></details><p className="mt-3 text-xs text-stone-500">آخر فحص: {row.lastValidatedAt?.toLocaleString("ar") ?? "غير متاح"} — أضيف في {row.createdAt.toLocaleString("ar")}</p></article>)}</div>}
    </section>
  </DashboardShell>;
}
