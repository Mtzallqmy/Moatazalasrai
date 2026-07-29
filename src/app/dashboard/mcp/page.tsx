import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { McpManager } from "@/components/mcp-manager";
import { currentSession } from "@/lib/auth/session";

export default async function McpPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin", "developer"].includes(session.role)) redirect("/forbidden");
  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/mcp"
      title="بوابة MCP"
      description="أضف خوادم MCP بعيدة، اكتشف أدواتها فعلياً، اختبر الاتصال واربط القدرات بالوكلاء."
    >
      <McpManager />
    </DashboardShell>
  );
}
