import Link from "next/link";
import type { DashboardSession } from "@/components/dashboard-navigation";

export function DashboardShell({ title, description, actions, children, variant = "default" }: {
  session: DashboardSession;
  activePath: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "chat";
}) {
  const chatLayout = variant === "chat";
  return (
    <>
        <header className={chatLayout ? "dashboard-header dashboard-header-chat" : "dashboard-header"}>
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
        <div className={chatLayout ? "dashboard-content dashboard-content-chat" : "dashboard-content"}>{children}</div>
    </>
  );
}
