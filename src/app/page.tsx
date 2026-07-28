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
            <span className="font-latin text-sm font-bold tracking-wide text-emerald-100 sm:text-base" dir="ltr">Moataz Agent Platform</span>
            <p className="mt-1 hidden text-xs text-stone-400 sm:block">منصة وكلاء مؤسسية مترابطة وآمنة</p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link className="secondary-button px-4 py-2" href="/login">تسجيل الدخول</Link>
            <Link className="primary-button px-4 py-2" href="/register">إنشاء حساب</Link>
          </div>
        </nav>

        <header className="grid gap-10 py-14 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:py-24">
          <div>
            <span className="inline-flex rounded-full border border-emerald-200/20 bg-emerald-100/10 px-3 py-1 text-sm text-emerald-100">منصة SaaS متعددة المؤسسات</span>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.35] text-stone-50 sm:text-5xl lg:text-6xl">أنشئ وكلاء ذكاء اصطناعي وشغّلهم ضمن بيئة مؤسسية موحدة</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">إدارة المؤسسات والمفاتيح المشفرة والوكلاء والإصدارات وعمليات التشغيل من واجهة عربية مترابطة مع Backend فعلي وPostgreSQL.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="primary-button" href="/register">ابدأ بإنشاء مؤسستك</Link>
              <Link className="secondary-button" href="/api/ready">فحص جاهزية الخدمات</Link>
            </div>
          </div>

          <aside className="soft-card overflow-hidden p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-stone-400">المسار الإنتاجي</p>
                <h2 className="mt-1 text-xl font-bold">من الإعداد إلى التشغيل</h2>
              </div>
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-200/25 via-stone-200/10 to-amber-200/20" />
            </div>
            <div className="mt-6 space-y-3 text-sm">
              {flow.map((step, index) => (
                <div key={step} className="flex items-center gap-3 rounded-2xl border border-stone-700/60 bg-stone-950/45 px-4 py-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-950">{index + 1}</span>
                  <span className="text-stone-200">{step}</span>
                </div>
              ))}
            </div>
          </aside>
        </header>

        <section className="grid gap-4 pb-16 sm:grid-cols-2">
          {pillars.map((pillar, index) => (
            <article key={pillar.title} className="soft-card p-6">
              <div className={`mb-5 h-1.5 w-14 rounded-full ${index % 2 === 0 ? "bg-emerald-200/70" : "bg-amber-100/60"}`} />
              <h2 className="text-lg font-bold text-stone-100">{pillar.title}</h2>
              <p className="mt-2 text-sm leading-7 text-stone-400">{pillar.desc}</p>
            </article>
          ))}
        </section>

        <footer className="border-t border-stone-700/70 py-8 text-center text-sm text-stone-500">برمجة وتطوير معتز العلقمي</footer>
      </div>
    </main>
  );
}
