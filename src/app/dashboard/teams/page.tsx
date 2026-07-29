import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { TeamManager } from "@/components/team-manager";
import { currentSession } from "@/lib/auth/session";

export default async function TeamsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  if (!["owner", "admin", "developer", "operator"].includes(session.role)) redirect("/forbidden");
  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/teams"
      title="فرق الوكلاء"
      description="شغّل عدة وكلاء متخصصين بالتوازي، ثم اجعل وكيل الإشراف يدمج النتائج في مخرج واحد قابل للتدقيق."
    >
      <TeamManager />
    </DashboardShell>
  );
}
