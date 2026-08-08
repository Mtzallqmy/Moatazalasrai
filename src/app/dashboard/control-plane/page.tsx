import { DashboardShell } from "@/components/dashboard-shell";
import { NotificationTemplateWorkbench } from "@/components/notification-template-workbench";
import { PlatformAdvancedControls } from "@/components/platform-advanced-controls";
import { PlatformControlCenter } from "@/components/platform-control-center";
import { requireSession } from "@/lib/auth/authorization";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can } from "@/lib/auth/permissions";

export default async function ControlPlanePage() {
  const session = await requireSession("control_plane:read");
  const customPermissions = can(session.role, "control_plane:manage")
    ? []
    : await loadCustomPermissions(session.organizationId, session.userId);
  const canManage = can(session.role, "control_plane:manage") || customPermissions.includes("control_plane:manage");

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/control-plane"
      title="مركز تحكم المؤسسة"
      description="إدارة وحدات المؤسسة وميزاتها وأدوارها المخصصة وإعداداتها وإشعاراتها وسلة محذوفاتها من مكان واحد."
    >
      <PlatformControlCenter canManage={canManage} />
      <PlatformAdvancedControls canManage={canManage} />
      <NotificationTemplateWorkbench canManage={canManage} />
    </DashboardShell>
  );
}
