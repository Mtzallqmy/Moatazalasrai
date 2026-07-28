import Link from "next/link";
import { redirect } from "next/navigation";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { currentSession } from "@/lib/auth/session";
import { platformIdentity } from "@/lib/platform/identity";

export default async function DiagnosticsPage() {
  const session = await currentSession();
  if (!session?.organizationId) redirect("/login");
  if (!session.role || !new Set(["owner", "admin"]).has(session.role)) redirect("/dashboard");

  return (
    <main className="app-shell">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="glass-panel rounded-3xl p-5 sm:p-7">
          <Link href="/dashboard" className="text-sm text-emerald-100 hover:text-emerald-50">العودة إلى لوحة التحكم</Link>
          <h1 className="mt-3 text-2xl font-black sm:text-3xl">مركز تشخيص المنصة</h1>
          <p className="mt-2 text-sm leading-7 text-stone-400">أداة إدارية حقيقية لفحص طبقات {platformIdentity.productName} والمسارات الحرجة دون كشف الأسرار.</p>
        </header>

        <div className="mt-5"><DiagnosticsPanel /></div>

        <footer className="mt-8 border-t border-stone-700/70 py-6 text-center text-sm text-stone-500">
          {platformIdentity.ownerRole}: {platformIdentity.ownerName}
        </footer>
      </div>
    </main>
  );
}
