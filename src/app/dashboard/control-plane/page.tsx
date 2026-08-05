import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { PlatformControlCenter } from "@/components/platform-control-center";
import { currentSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";

export default async function ControlPlanePage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.organizationName || !session.role) redirect("/select-organization");
  if (!can(session.role, "platform:read")) redirect("/dashboard");

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/control-plane"
      title="مركز تحكم المنصة"
      description="إدارة الوحدات والميزات والأدوار المخصصة والإعدادات والإشعارات وسلة المحذوفات من مكان واحد."
    >
      <PlatformControlCenter canManage={can(session.role, "platform:manage")} />
    </DashboardShell>
  );
}
