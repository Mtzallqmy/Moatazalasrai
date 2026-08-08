import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentSession } from "@/lib/auth/session";
import { supabaseAuthConfigured } from "@/lib/supabase/config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  if (await currentSession()) redirect("/dashboard");
  const reason = (await searchParams).reason;

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-12">
      <section className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8">
        <Link href="/" className="font-latin text-sm font-bold tracking-wide text-emerald-100" dir="ltr">Moataz Agent Platform</Link>
        <h1 className="mt-5 text-3xl font-black text-stone-50">تسجيل الدخول</h1>
        <p className="mt-2 text-sm leading-7 text-stone-400">ادخل إلى مؤسستك لإدارة الوكلاء والمزودين وعمليات التشغيل.</p>
        {reason === "access-expired" ? <p role="alert" className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">انتهت مدة استخدام الحساب وتم تسجيل خروجك تلقائيًا. راجع مالك المؤسسة أو مديرها لتجديد الوصول.</p> : null}
        {reason === "oauth-failed" ? <p role="alert" className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">تعذر إكمال دخول Google أو ربط الحساب. أعد المحاولة أو استخدم البريد.</p> : null}
        <div className="mt-8"><AuthForm mode="login" googleEnabled={supabaseAuthConfigured()} turnstileSiteKey={process.env.TURNSTILE_ENABLED === "true" ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : undefined} /></div>
        <p className="mt-6 text-center text-sm text-stone-400">لا تملك حسابًا؟ <Link className="font-semibold text-emerald-100" href="/register">أنشئ حسابًا</Link></p>
      </section>
    </main>
  );
}
