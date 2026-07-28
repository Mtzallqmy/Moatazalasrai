import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentSession } from "@/lib/auth/session";

export default async function RegisterPage() {
  if (await currentSession()) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
        <Link href="/" className="text-sm font-semibold text-blue-600">Moataz Agent Platform</Link>
        <h1 className="mt-4 text-3xl font-bold text-slate-950">إنشاء حساب جديد</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">سيُنشأ حسابك ومؤسستك الأولى، وستصبح مالك المؤسسة تلقائيًا.</p>
        <div className="mt-8"><AuthForm mode="register" /></div>
        <p className="mt-6 text-center text-sm text-slate-600">لديك حساب؟ <Link className="font-semibold text-blue-600" href="/login">سجّل الدخول</Link></p>
      </section>
    </main>
  );
}
