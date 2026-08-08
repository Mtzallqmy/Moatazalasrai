import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { MfaSettings } from "@/components/mfa-settings";
import { SettingsForms } from "@/components/settings-forms";
import { WhatsAppConnectionCard } from "@/components/whatsapp-connection-card";
import { currentSession } from "@/lib/auth/session";

export default async function SettingsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.organizationName || !session.role) redirect("/select-organization");
  const canManageOrganization = ["owner", "admin"].includes(session.role);
  return (
    <DashboardShell session={session} activePath="/dashboard/settings" title="إعدادات الحساب والمؤسسة" description="تحديث البيانات وتدوير كلمات المرور والجلسات وإدارة المصادقة متعددة العوامل وقنوات الاتصال الآمنة.">
      <SettingsForms name={session.name} organizationName={session.organizationName} canManageOrganization={canManageOrganization} />
      <MfaSettings />
      <WhatsAppConnectionCard />
    </DashboardShell>
  );
}
