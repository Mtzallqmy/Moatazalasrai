const pillars = [
  {
    title: "منصة متعددة المؤسسات",
    desc: "عزل كامل للبيانات والمفاتيح والوكلاء وعمليات التشغيل حسب المؤسسة.",
  },
  {
    title: "عدة مزوّدين",
    desc: "بوابة موحدة لـ OpenAI وAnthropic وGemini دون ربط المنصة بمزوّد واحد.",
  },
  {
    title: "مفاتيح مشفرة",
    desc: "تُحفظ مفاتيح BYOK مشفرة باستخدام AES-256-GCM ولا تصل إلى المتصفح بعد تخزينها.",
  },
  {
    title: "تشغيل قابل للتدقيق",
    desc: "إصدارات للوكلاء، وسجل Runs وأحداث واستهلاك Tokens وسجل تدقيق للمؤسسة.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-16">
      <header className="flex flex-col gap-4">
        <span className="text-sm font-semibold text-brand-600">Moataz Agent Platform</span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          نواة إنتاجية لبناء وتشغيل وكلاء ذكاء اصطناعي متعددين
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-slate-600">
          منصة API متعددة المؤسسات لإدارة مزوّدي النماذج والمفاتيح المشفرة والوكلاء ذات الإصدارات
          وعمليات التشغيل. استخدم واجهات <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">/api/v1</code>
          للتهيئة والإدارة والتشغيل.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <a className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700" href="/api/health">
            فحص صحة الخدمة
          </a>
          <a className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-50" href="https://github.com/Mtzallqmy/Moatazalasrai">
            المستودع
          </a>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {pillars.map((pillar) => (
          <article key={pillar.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 font-semibold text-slate-950">{pillar.title}</h2>
            <p className="text-sm leading-6 text-slate-600">{pillar.desc}</p>
          </article>
        ))}
      </section>

      <footer className="border-t border-slate-200 pt-6 text-sm text-slate-500">
        <p>راجع <code>docs/DEPLOYMENT.md</code> لإعداد Railway والمتغيرات والترحيلات وتهيئة أول مؤسسة.</p>
        <p className="mt-3 font-medium text-slate-700">برمجة وتطوير معتز العلقمي</p>
      </footer>
    </main>
  );
}
