import { DashboardShell } from "@/components/dashboard-shell";
import { PlatformAdvancedControls } from "@/components/platform-advanced-controls";
import { PlatformControlCenter } from "@/components/platform-control-center";
import { requireSession } from "@/lib/auth/authorization";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can } from "@/lib/auth/permissions";

export default async function ControlPlanePage() {
  const session = await requireSession("platform:read");
  const customPermissions = can(session.role, "platform:manage")
    ? []
    : await loadCustomPermissions(session.organizationId, session.userId);
  const canManage = can(session.role, "platform:manage") || customPermissions.includes("platform:manage");

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/control-plane"
      title="مركز تحكم المنصة"
      description="إدارة الوحدات والميزات والأدوار المخصصة والإعدادات والإشعارات وسلة المحذوفات من مكان واحد."
    >
      <PlatformControlCenter canManage={canManage} />
      <PlatformAdvancedControls canManage={canManage} />
    </DashboardShell>
  );
}
