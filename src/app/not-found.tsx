import Link from "next/link";

export default function NotFound() {
  return <main className="app-shell grid min-h-screen place-items-center px-5"><section className="soft-card max-w-lg p-8 text-center"><p className="text-sm text-amber-100">404</p><h1 className="mt-2 text-3xl font-black">الصفحة غير موجودة</h1><p className="mt-3 text-sm leading-7 text-stone-400">قد يكون الرابط قديمًا أو لا ينتمي إلى مؤسستك الحالية.</p><Link className="primary-button mt-6" href="/">العودة للرئيسية</Link></section></main>;
}
