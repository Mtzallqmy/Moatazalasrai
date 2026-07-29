import Link from "next/link";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { DashboardNavigation, type DashboardSession } from "@/components/dashboard-navigation";
import { SiteFooter } from "@/components/site-footer";

export function DashboardShell({ session, activePath, title, description, children }: {
  session: DashboardSession;
  activePath: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="dashboard-root">
      <DashboardNavigation session={session} activePath={activePath} />
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
            <span className="system-status"><i aria-hidden="true" /> المنصة تعمل بكفاءة</span>
            <OrganizationSwitcher activeOrganizationId={session.organizationId} />
          </div>
        </header>
        <div className="dashboard-content">{children}</div>
        <SiteFooter compact />
      </section>
    </main>
  );
}
