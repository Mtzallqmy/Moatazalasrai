import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ToolApprovalsManager } from "@/components/tool-approvals-manager";
import { currentSession } from "@/lib/auth/session";

export default async function ToolApprovalsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin", "developer", "operator"].includes(session.role)) redirect("/forbidden");
  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/approvals"
      title="موافقات الأدوات"
      description="راجع أدوات MCP ذات الخطورة أو الآثار الجانبية، ثم استأنف نفس التشغيل بعد قرار موثق."
    >
      <ToolApprovalsManager />
    </DashboardShell>
  );
}
