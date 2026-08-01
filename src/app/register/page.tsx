import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentSession } from "@/lib/auth/session";

export default async function RegisterPage() {
  if (await currentSession()) redirect("/dashboard");

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-12">
      <section className="glass-panel w-full max-w-lg rounded-3xl p-6 sm:p-8">
        <Link href="/" className="font-latin text-sm font-bold tracking-wide text-emerald-100" dir="ltr">Moataz Agent Platform</Link>
        <h1 className="mt-5 text-3xl font-black text-stone-50">إنشاء حساب جديد</h1>
        <p className="mt-2 text-sm leading-7" style={{ color: "var(--text-secondary)" }}>سيُنشأ حساب مستخدم عادي لا يملك صلاحيات الإدارة أو الإعدادات الحساسة. يمنح المالك الترقية لاحقًا من إدارة الأعضاء عند الحاجة.</p>
        <div className="mt-8"><AuthForm mode="register" turnstileSiteKey={process.env.TURNSTILE_ENABLED === "true" ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : undefined} /></div>
        <p className="mt-6 text-center text-sm text-stone-400">لديك حساب؟ <Link className="font-semibold text-emerald-100" href="/login">سجّل الدخول</Link></p>
      </section>
    </main>
  );
}
