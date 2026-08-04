import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { RepositoryBrowser } from "@/components/repository-browser";
import { currentSession } from "@/lib/auth/session";

export default async function RepositoriesPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");
  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/repositories"
      title="المستودعات البرمجية"
      description="تصفح مستودعات GitHub المرتبطة مباشرة من الخادم، دون إرسال التوكن أو تحميل المستودع كاملًا إلى المتصفح."
    >
      <RepositoryBrowser />
    </DashboardShell>
  );
}
