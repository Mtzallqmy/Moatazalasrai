"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="app-shell grid min-h-screen place-items-center px-5"><section className="soft-card max-w-lg p-8 text-center"><h1 className="text-3xl font-black">تعذر عرض الصفحة</h1><p className="mt-3 text-sm leading-7 text-stone-400">لم تُعرض تفاصيل داخلية حفاظًا على الأمان. يمكنك إعادة المحاولة.</p><button className="primary-button mt-6" onClick={reset}>إعادة المحاولة</button></section></main>;
}
