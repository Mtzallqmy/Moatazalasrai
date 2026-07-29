import Link from "next/link";

export default function ForbiddenPage() {
  return <main className="app-shell grid min-h-screen place-items-center px-5"><section className="soft-card max-w-lg p-8 text-center"><p className="text-sm text-rose-100">403</p><h1 className="mt-2 text-3xl font-black">لا تملك الصلاحية</h1><p className="mt-3 text-sm leading-7 text-stone-400">تم منع الوصول من الباكند لأن دورك لا يسمح بهذه العملية.</p><Link className="primary-button mt-6" href="/dashboard">العودة للوحة التحكم</Link></section></main>;
}
