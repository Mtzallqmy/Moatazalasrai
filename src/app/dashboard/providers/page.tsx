import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
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
    secretHint: providerCredentials.secretHint,
    enabled: providerCredentials.enabled,
    createdAt: providerCredentials.createdAt,
  }).from(providerCredentials).where(eq(providerCredentials.organizationId, session.organizationId)).orderBy(desc(providerCredentials.createdAt));

  return (
    <main className="app-shell">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="glass-panel rounded-3xl p-5 sm:p-7">
          <Link href="/dashboard" className="text-sm text-emerald-100 hover:text-emerald-50">العودة إلى لوحة التحكم</Link>
          <h1 className="mt-3 text-2xl font-black sm:text-3xl">مزودو نماذج الذكاء الاصطناعي</h1>
          <p className="mt-2 text-sm leading-7 text-stone-400">إدارة مفاتيح OpenAI وAnthropic وGemini الخاصة بمؤسسة {session.organizationName}. لا تُعرض القيم الأصلية بعد الحفظ.</p>
        </header>

        <div className="mt-5"><ProviderForm /></div>

        <section className="soft-card mt-5 p-5 sm:p-6">
          <h2 className="text-lg font-bold">الاتصالات المحفوظة</h2>
          {rows.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-stone-700 px-4 py-12 text-center text-sm text-stone-400">لم تتم إضافة أي مفاتيح مزودين بعد.</div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {rows.map((row) => (
                <article key={row.id} className="rounded-2xl border border-stone-700/70 bg-stone-950/45 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-latin text-xs uppercase tracking-wider text-emerald-100" dir="ltr">{row.provider}</p>
                      <h3 className="mt-1 font-bold text-stone-100">{row.name}</h3>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs ${row.enabled ? "bg-emerald-100/10 text-emerald-100" : "bg-stone-800 text-stone-400"}`}>{row.enabled ? "مفعّل" : "معطّل"}</span>
                  </div>
                  <p className="mt-4 font-mono text-sm text-stone-300" dir="ltr">{row.secretHint}</p>
                  <p className="mt-3 text-xs text-stone-500">أضيف في {row.createdAt.toLocaleString("ar")}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-8 border-t border-stone-700/70 py-6 text-center text-sm text-stone-500">برمجة وتطوير معتز العلقمي</footer>
      </div>
    </main>
  );
}
