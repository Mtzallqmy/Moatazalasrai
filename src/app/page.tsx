import Link from "next/link";

const pillars = [
  {
    title: "الواجهة (Frontend)",
    desc: "Next.js 14 App Router + TypeScript + Tailwind — نفس التطبيق يخدم الواجهة والـ API.",
  },
  {
    title: "قاعدة البيانات",
    desc: "Neon Postgres عبر Drizzle ORM ومُحرّك HTTP (بدون بروتوكول TCP الخام) — يعمل على أي بيئة، حتى Edge.",
  },
  {
    title: "النشر (Deploy)",
    desc: "Dockerfile لأي مزوّد (Railway/Render)، وتهيئة جاهزة لـ Cloudflare Pages — بدون ارتباط بمزوّد واحد.",
  },
  {
    title: "الجودة",
    desc: "TypeScript صارم، ESLint، اختبارات Vitest، وGitHub Actions CI على كل push.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <span className="text-sm font-medium text-brand-600">Moataz AI Platform</span>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          نقطة انطلاق إنتاجية جاهزة — من GitHub إلى Neon إلى Cloudflare/Railway
        </h1>
        <p className="max-w-2xl text-slate-600">
          هذا المشروع ليس صفحة فارغة: فيه ميزة حقيقية تعمل (إدارة مهام) تُثبت أن كل
          حلقة السلسلة متصلة وتعمل فعليًا — من الواجهة إلى الـ API إلى قاعدة البيانات.
        </p>
        <div>
          <Link
            href="/tasks"
            className="inline-flex items-center rounded-lg bg-brand-600 px-5 py-2.5 text-white transition hover:bg-brand-700"
          >
            جرّب واجهة المهام →
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {pillars.map((p) => (
          <div key={p.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 font-semibold text-slate-900">{p.title}</h2>
            <p className="text-sm text-slate-600">{p.desc}</p>
          </div>
        ))}
      </section>

      <footer className="text-sm text-slate-400">
        راجع README.md لخطوات التشغيل والنشر الكاملة.
      </footer>
    </main>
  );
}
