import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { currentSession } from "@/lib/auth/session";
import { platformIdentity } from "@/lib/platform/identity";

export default async function DiagnosticsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!new Set(["owner", "admin"]).has(session.role)) redirect("/forbidden");

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/diagnostics"
      title="تشخيص مساحة العمل"
      description="فحوص خاصة بالمؤسسة الحالية للخدمات والمزودين والتكاملات والتشغيل دون كشف بيانات حساسة."
      actions={<Link href="/dashboard" className="secondary-button">العودة إلى لوحة التحكم</Link>}
    >
      <DiagnosticsPanel />
      <p className="mt-5 text-center text-sm text-stone-500">{platformIdentity.ownerRole}: {platformIdentity.ownerName}</p>
    </DashboardShell>
  );
}
