import Link from "next/link";

const pillars = [
  { title: "عزل مؤسسي حقيقي", desc: "كل مستخدم يعمل داخل مؤسسة محددة، وتُقيّد الاستعلامات والموارد بمعرّف المؤسسة." },
  { title: "جلسات آمنة", desc: "تسجيل ودخول فعليان باستخدام كلمات مرور مشتقة وجلسات مخزنة في PostgreSQL وCookies آمنة." },
  { title: "عدة مزوّدين", desc: "بوابة موحدة لـ OpenAI وAnthropic وGemini مع حفظ مفاتيح BYOK بصورة مشفرة." },
  { title: "تشغيل قابل للتدقيق", desc: "إصدارات للوكلاء وسجل Runs وأحداث واستهلاك Tokens وسجل تدقيق للمؤسسة." },
];

const flow = ["إنشاء حساب ومؤسسة", "إضافة مفتاح مزود مشفر", "إنشاء وكيل وإصدار", "تشغيل الوكيل ومراجعة النتائج"];

export default function HomePage() {
  return (
    <main className="app-shell">
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
        <nav className="glass-panel flex items-center justify-between gap-4 rounded-3xl px-4 py-3 sm:px-6">
          <div>
            <span className="font-latin text-sm font-bold tracking-wide sm:text-base" style={{ color: "var(--primary)" }} dir="ltr">Moataz Agent Platform</span>
            <p className="mt-1 hidden text-xs sm:block" style={{ color: "var(--text-secondary)" }}>منصة وكلاء مؤسسية مترابطة وآمنة</p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link className="secondary-button px-4 py-2" href="/login">تسجيل الدخول</Link>
            <Link className="primary-button px-4 py-2" href="/register">إنشاء حساب</Link>
          </div>
        </nav>

        <header className="grid gap-10 py-14 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:py-24">
          <div>
            <span className="inline-flex rounded-full border px-3 py-1 text-sm" style={{ color: "var(--accent)", borderColor: "color-mix(in srgb,var(--accent) 30%,var(--border))", background: "var(--accent-soft)" }}>منصة SaaS متعددة المؤسسات</span>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.35] sm:text-5xl lg:text-6xl">أنشئ وكلاء ذكاء اصطناعي وشغّلهم ضمن بيئة مؤسسية موحدة</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8" style={{ color: "var(--text-secondary)" }}>إدارة المؤسسات والمفاتيح المشفرة والوكلاء والإصدارات وعمليات التشغيل من واجهة عربية مترابطة مع Backend فعلي وPostgreSQL.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="primary-button" href="/register">ابدأ بإنشاء مؤسستك</Link>
              <Link className="secondary-button" href="/api/ready">فحص جاهزية الخدمات</Link>
            </div>
          </div>

          <aside className="soft-card overflow-hidden p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>المسار الإنتاجي</p>
                <h2 className="mt-1 text-xl font-bold">من الإعداد إلى التشغيل</h2>
              </div>
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-200/25 via-stone-200/10 to-amber-200/20" />
            </div>
            <div className="mt-6 space-y-3 text-sm">
              {flow.map((step, index) => (
                <div key={step} className="flex items-center gap-3 rounded-2xl border px-4 py-4" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ background: "var(--primary)" }}>{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </aside>
        </header>

        <section className="grid gap-4 pb-16 sm:grid-cols-2">
          {pillars.map((pillar, index) => (
            <article key={pillar.title} className="soft-card p-6">
              <div className="mb-5 h-1.5 w-14 rounded-full" style={{ background: index % 2 === 0 ? "var(--primary)" : "var(--accent)" }} />
              <h2 className="text-lg font-bold">{pillar.title}</h2>
              <p className="mt-2 text-sm leading-7" style={{ color: "var(--text-secondary)" }}>{pillar.desc}</p>
            </article>
          ))}
        </section>

        <footer className="border-t py-8 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>برمجة وتطوير معتز العلقمي</footer>
      </div>
    </main>
  );
}
