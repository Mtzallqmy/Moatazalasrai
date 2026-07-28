"use client";

import { useState } from "react";

type DiagnosticPayload = {
  success: boolean;
  data?: {
    status: "healthy" | "degraded";
    checkedAt: string;
    checks: Array<{ name: string; status: "pass" | "fail"; latencyMs: number; details: string }>;
    routes: Array<{ path: string; category: string }>;
    summary: { total: number; passed: number; failed: number };
  };
  error?: { message?: string };
};

export function DiagnosticsPanel() {
  const [result, setResult] = useState<DiagnosticPayload | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    const response = await fetch("/api/diagnostics", { cache: "no-store" });
    const payload = await response.json().catch(() => ({ success: false, error: { message: "تعذر قراءة نتيجة التشخيص." } })) as DiagnosticPayload;
    setResult(payload);
    setLoading(false);
  }

  return (
    <div className="space-y-5">
      <section className="soft-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-stone-100">الفحص التشخيصي الشامل</h2>
            <p className="mt-1 text-sm leading-7 text-stone-400">يفحص البيئة، قاعدة البيانات، التشفير، الجلسة، وعزل المؤسسة، ويعرض سجل المسارات الحرجة.</p>
          </div>
          <button onClick={run} disabled={loading} className="primary-button disabled:cursor-not-allowed disabled:opacity-60">{loading ? "جارٍ الفحص..." : "بدء الفحص الآن"}</button>
        </div>
      </section>

      {result?.error?.message ? <div className="rounded-2xl border border-rose-200/20 bg-rose-200/10 p-4 text-sm text-rose-100">{result.error.message}</div> : null}

      {result?.data ? (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Metric label="إجمالي الفحوص" value={result.data.summary.total} />
            <Metric label="الناجحة" value={result.data.summary.passed} />
            <Metric label="الفاشلة" value={result.data.summary.failed} />
          </section>

          <section className="soft-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-bold text-stone-100">نتائج الخدمات</h3>
              <span className={`rounded-full px-3 py-1 text-xs ${result.data.status === "healthy" ? "bg-emerald-100/10 text-emerald-100" : "bg-rose-200/10 text-rose-100"}`}>{result.data.status === "healthy" ? "سليم" : "متدهور"}</span>
            </div>
            <div className="mt-5 grid gap-3">
              {result.data.checks.map((check) => (
                <article key={check.name} className="rounded-2xl border border-stone-700/70 bg-stone-950/45 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-latin text-sm font-semibold text-stone-100" dir="ltr">{check.name}</p>
                      <p className="mt-1 text-sm text-stone-400">{check.details}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={check.status === "pass" ? "text-emerald-100" : "text-rose-100"}>{check.status === "pass" ? "نجح" : "فشل"}</span>
                      <span className="text-stone-500">{check.latencyMs}ms</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="soft-card p-5 sm:p-6">
            <h3 className="font-bold text-stone-100">المسارات الحرجة المسجلة</h3>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-right text-stone-400"><tr><th className="pb-3">المسار</th><th className="pb-3">التصنيف</th><th className="pb-3">الحماية</th></tr></thead>
                <tbody className="divide-y divide-stone-800">
                  {result.data.routes.map((route) => (
                    <tr key={route.path}><td className="py-4 font-mono text-xs" dir="ltr">{route.path}</td><td className="py-4">{route.category}</td><td className="py-4">{route.category === "public" || route.category === "auth" || route.category === "system" ? "عام/مقيد وظيفيًا" : "يتطلب مصادقة"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="soft-card p-5"><p className="text-sm text-stone-400">{label}</p><p className="mt-3 text-3xl font-black text-stone-50">{value}</p></article>;
}
