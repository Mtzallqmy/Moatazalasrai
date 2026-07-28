import Link from "next/link";

const pillars = [
  { title: "عزل مؤسسي حقيقي", desc: "كل مستخدم يعمل داخل مؤسسة محددة، وتُقيّد الاستعلامات والموارد بمعرّف المؤسسة." },
  { title: "جلسات آمنة", desc: "تسجيل ودخول فعليان باستخدام كلمات مرور مشتقة عبر scrypt وجلسات مخزنة في PostgreSQL وCookies من نوع HttpOnly." },
  { title: "عدة مزوّدين", desc: "بوابة موحدة لـ OpenAI وAnthropic وGemini مع حفظ مفاتيح BYOK بصورة مشفرة." },
  { title: "تشغيل قابل للتدقيق", desc: "إصدارات للوكلاء وسجل Runs وأحداث واستهلاك Tokens وسجل تدقيق للمؤسسة." },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <nav className="flex items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <span className="text-sm font-bold text-blue-400 sm:text-base">Moataz Agent Platform</span>
          <div className="flex gap-2 text-sm">
            <Link className="rounded-xl border border-slate-700 px-4 py-2 hover:bg-slate-900" href="/login">تسجيل الدخول</Link>
            <Link className="rounded-xl bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500" href="/register">إنشاء حساب</Link>
          </div>
        </nav>

        <header className="grid gap-10 py-16 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:py-24">
          <div>
            <span className="inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-300">منصة SaaS متعددة المؤسسات</span>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight sm:text-5xl lg:text-6xl">أنشئ وكلاء ذكاء اصطناعي وشغّلهم من منصة واحدة آمنة</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">إدارة المؤسسات ومفاتيح المزودين والوكلاء وإصداراتهم وعمليات التشغيل من Backend فعلي مرتبط بـPostgreSQL.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-500" href="/register">ابدأ بإنشاء مؤسستك</Link>
              <Link className="rounded-xl border border-slate-700 px-6 py-3 font-semibold hover:bg-slate-900" href="/api/ready">فحص قاعدة البيانات</Link>
            </div>
          </div>
          <aside className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-blue-950/30">
            <p className="text-sm text-slate-400">المسار الإنتاجي</p>
            <div className="mt-5 space-y-4 text-sm">
              {["إنشاء حساب ومؤسسة", "إضافة مفاتيح المزودين", "إنشاء وكيل وإصدار", "تشغيل الوكيل ومراجعة النتائج"].map((step, index) => (
                <div key={step} className="flex items-center gap-3 rounded-2xl bg-slate-950 px-4 py-4"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 font-bold">{index + 1}</span><span>{step}</span></div>
              ))}
            </div>
          </aside>
        </header>

        <section className="grid gap-4 pb-16 sm:grid-cols-2">
          {pillars.map((pillar) => <article key={pillar.title} className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><h2 className="font-bold">{pillar.title}</h2><p className="mt-2 text-sm leading-7 text-slate-400">{pillar.desc}</p></article>)}
        </section>

        <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-500">برمجة وتطوير معتز العلقمي</footer>
      </div>
    </main>
  );
}
