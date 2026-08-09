import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardNavigation } from "@/components/dashboard-navigation";
import { SessionExpiryGuard } from "@/components/session-expiry-guard";
import { currentSession } from "@/lib/auth/session";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { SiteFooter } from "@/components/site-footer";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.organizationId || !session.role) redirect("/select-organization");

  const permissions = await loadCustomPermissions(session.organizationId, session.userId);

  return (
    <main className="dashboard-root">
      <SessionExpiryGuard expiresAt={session.accessExpiresAt} />
      <DashboardNavigation session={{ ...session, permissions }} activePath="/dashboard" />
      <section className="dashboard-main" id="main-content">
        {children}
        <SiteFooter compact />
      </section>
    </main>
  );
}
