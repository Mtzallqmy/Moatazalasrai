import { BrowserTasksManager } from "@/components/browser-tasks-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireSession } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function BrowserTasksPage() {
  const session = await requireSession("browser_tasks:read");
  return (
    <DashboardShell session={session} activePath="/dashboard/browser-tasks" title="مهام المتصفح" description="تشغيل مهام المتصفح ومتابعتها وإلغاؤها ضمن اتصالات الموقع المصرح بها.">
      <BrowserTasksManager />
    </DashboardShell>
  );
}
