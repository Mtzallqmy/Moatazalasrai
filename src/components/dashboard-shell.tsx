import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { DashboardNavigation, type DashboardSession } from "@/components/dashboard-navigation";
import { SiteFooter } from "@/components/site-footer";
import { db } from "@/db";
import { platformModules } from "@/db/control-plane-schema";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { SessionExpiryGuard } from "@/components/session-expiry-guard";

export async function DashboardShell({ session, activePath, title, description, actions, children }: {
  session: DashboardSession;
  activePath: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [permissions, modules] = session.organizationId && session.userId
    ? await Promise.all([
      loadCustomPermissions(session.organizationId, session.userId),
      db().select({ key: platformModules.key }).from(platformModules).where(and(
        eq(platformModules.organizationId, session.organizationId),
        eq(platformModules.status, "active"),
        isNull(platformModules.deletedAt),
      )).orderBy(asc(platformModules.position)),
    ])
    : [[], []];
  const navigationSession = { ...session, permissions, modules: modules.map((module) => module.key) };

  return (
    <main className="dashboard-root">
      <SessionExpiryGuard expiresAt={session.accessExpiresAt} />
      <DashboardNavigation session={navigationSession} activePath={activePath} />
      <section className="dashboard-main" id="main-content">
        <header className="dashboard-header">
          <div className="min-w-0">
            <p className="dashboard-breadcrumb">
              <Link href="/dashboard">مساحة العمل</Link>
              <span aria-hidden="true">/</span>
              <span>{title}</span>
            </p>
            <h1>{title}</h1>
            {description ? <p className="dashboard-description">{description}</p> : null}
          </div>
          <div className="dashboard-header-actions">
            {actions}
            <OrganizationSwitcher activeOrganizationId={session.organizationId} />
          </div>
        </header>
        <div className="dashboard-content">{children}</div>
        <SiteFooter compact />
      </section>
    </main>
  );
}
