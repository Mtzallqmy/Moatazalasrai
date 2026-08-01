import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentSession } from "@/lib/auth/session";

export default async function LoginPage() {
  if (await currentSession()) redirect("/dashboard");

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-12">
      <section className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8">
        <Link href="/" className="font-latin text-sm font-bold tracking-wide text-emerald-100" dir="ltr">Moataz Agent Platform</Link>
        <h1 className="mt-5 text-3xl font-black text-stone-50">تسجيل الدخول</h1>
        <p className="mt-2 text-sm leading-7 text-stone-400">ادخل إلى مؤسستك لإدارة الوكلاء والمزودين وعمليات التشغيل.</p>
        <div className="mt-8"><AuthForm mode="login" turnstileSiteKey={process.env.TURNSTILE_ENABLED === "true" ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : undefined} /></div>
        <p className="mt-6 text-center text-sm text-stone-400">لا تملك حسابًا؟ <Link className="font-semibold text-emerald-100" href="/register">أنشئ حسابًا</Link></p>
      </section>
    </main>
  );
}
