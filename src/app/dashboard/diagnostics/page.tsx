import Link from "next/link";
import { redirect } from "next/navigation";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { ProductionControlCenter } from "@/components/production-control-center";
import { WhatsAppRuntimeStatus } from "@/components/whatsapp-runtime-status";
import { currentSession } from "@/lib/auth/session";
import { platformIdentity } from "@/lib/platform/identity";
import { inspectWhatsAppEnvironment } from "@/lib/platform/whatsapp-environment";
import styles from "./diagnostics.module.css";

export default async function DiagnosticsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!new Set(["owner", "admin"]).has(session.role)) redirect("/forbidden");

  const whatsappEnvironmentManaged = inspectWhatsAppEnvironment().authoritative;

  return (
    <main className="app-shell">
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
        <header className="glass-panel rounded-3xl p-5 sm:p-7">
          <Link href="/dashboard" className="text-sm text-emerald-100 hover:text-emerald-50">العودة إلى لوحة التحكم</Link>
          <p className="eyebrow mt-4">Admin Operations</p>
          <h1 className="mt-3 text-2xl font-black sm:text-3xl">مركز تشغيل وإدارة المنصة</h1>
          <p className="mt-2 max-w-4xl text-sm leading-7 text-stone-400">
            تحكم إداري حقيقي في WhatsApp وSandbox ومتصفح الوكيل، مع فحص الخدمات والعامل وقاعدة البيانات دون كشف الأسرار.
          </p>
        </header>

        {whatsappEnvironmentManaged ? <div className="mt-5"><WhatsAppRuntimeStatus /></div> : null}
        <div className={`mt-5 ${whatsappEnvironmentManaged ? styles.environmentManaged : ""}`}>
          <ProductionControlCenter />
        </div>
        <div className="mt-5"><DiagnosticsPanel /></div>

        <footer className="mt-8 border-t border-stone-700/70 py-6 text-center text-sm text-stone-500">
          {platformIdentity.ownerRole}: {platformIdentity.ownerName}
        </footer>
      </div>
    </main>
  );
}
