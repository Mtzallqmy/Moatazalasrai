import { redirect } from "next/navigation";
import { ChannelManager } from "@/components/channel-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { currentSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";

export default async function ChannelsPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.organizationName || !session.role) redirect("/select-organization");
  if (!can(session.role, "channels:read")) redirect("/dashboard");

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/channels"
      title="القنوات"
      description="حالة قنوات Telegram وWhatsApp وWeb/API في مكان واحد. تظهر الإعدادات المتقدمة فقط داخل قسم التكامل المناسب."
    >
      <ChannelManager canManage={can(session.role, "channels:manage")} />
    </DashboardShell>
  );
}
