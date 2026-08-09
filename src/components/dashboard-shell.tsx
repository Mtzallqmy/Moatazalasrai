import Link from "next/link";
import type { DashboardSession } from "@/components/dashboard-navigation";

export function DashboardShell({ title, description, actions, children }: {
  session: DashboardSession;
  activePath: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
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
          </div>
        </header>
        <div className="dashboard-content">{children}</div>
    </>
  );
}
