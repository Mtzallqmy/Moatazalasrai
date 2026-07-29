"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, Bot, Boxes, Braces, ChevronDown, CircleGauge, Database,
  FileText, Home, KeyRound, Menu, MessageSquare, Moon, Network,
  PlayCircle, Search, Settings, ShieldCheck, Users, Workflow, X,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";

export type DashboardSession = {
  name: string | null;
  email: string;
  organizationId: string | null;
  organizationName: string | null;
  role: string | null;
};

const navigation = [
  { label: "نظرة عامة", href: "/dashboard", icon: Home },
  { label: "المحادثات", href: "/dashboard/chat", icon: MessageSquare, roles: ["owner", "admin", "developer", "operator", "member"] },
  { label: "الوكلاء", href: "/dashboard/agents", icon: Bot },
  { label: "فرق الوكلاء", href: "/dashboard/teams", icon: Workflow, roles: ["owner", "admin", "developer", "operator"] },
  { label: "عمليات التشغيل", href: "/dashboard/runs", icon: PlayCircle, roles: ["owner", "admin", "developer", "operator"] },
  { label: "الملفات والمعرفة", href: "/dashboard/files", icon: FileText, roles: ["owner", "admin", "developer", "operator", "member"] },
  { label: "المزودون والنماذج", href: "/dashboard/providers", icon: Database, roles: ["owner", "admin", "developer"] },
  { label: "بوابة MCP", href: "/dashboard/mcp", icon: Braces, roles: ["owner", "admin", "developer"] },
  { label: "التكاملات", href: "/dashboard/integrations", icon: Boxes, roles: ["owner", "admin"] },
  { label: "الأعضاء والصلاحيات", href: "/dashboard/members", icon: Users, roles: ["owner", "admin"] },
  { label: "سجل التدقيق", href: "/dashboard/audit", icon: ShieldCheck, roles: ["owner", "admin"] },
  { label: "صحة المنصة", href: "/dashboard/diagnostics", icon: Activity, roles: ["owner", "admin"] },
  { label: "الإعدادات", href: "/dashboard/settings", icon: Settings },
] as const;

function ThemeButton() {
  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("moataz-theme", next ? "dark" : "light");
  }
  return (
    <button className="icon-button" type="button" onClick={toggle} aria-label="تبديل المظهر">
      <Moon size={18} />
    </button>
  );
}

function Sidebar({ session, activePath, close }: {
  session: DashboardSession;
  activePath: string;
  close?: () => void;
}) {
  const pathname = usePathname();
  const current = pathname || activePath;
  return (
    <aside className="dashboard-sidebar" aria-label="التنقل الرئيسي">
      <div className="sidebar-brand">
        <span className="sidebar-logo" aria-hidden="true"><Network size={22} /></span>
        <div>
          <strong>معتز <bdi dir="ltr">AI</bdi></strong>
          <span>مركز العمليات الذكية</span>
        </div>
      </div>
      <button className="workspace-switcher" type="button">
        <span className="workspace-avatar">{(session.organizationName || "م").slice(0, 1)}</span>
        <span className="min-w-0">
          <b>مساحة العمل</b>
          <small>{session.organizationName ?? "المؤسسة"}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <nav className="sidebar-nav">
        <p className="nav-section-label">العمل</p>
        {navigation.filter((item) => !("roles" in item) || (item.roles as readonly string[]).includes(session.role ?? "")).map((item) => {
          const active = item.href === "/dashboard" ? current === item.href : current.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} onClick={close} aria-current={active ? "page" : undefined}
              className={`sidebar-link${active ? " sidebar-link-active" : ""}`}>
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-account">
        <div className="account-avatar">{(session.name || session.email).slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0">
          <b>{session.name || "الحساب"}</b>
          <span dir="ltr">{session.email}</span>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}

export function DashboardNavigation({ session, activePath }: { session: DashboardSession; activePath: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <>
      <div className="desktop-sidebar"><Sidebar session={session} activePath={activePath} /></div>
      <header className="mobile-dashboard-bar">
        <button className="icon-button" type="button" onClick={() => setOpen(true)} aria-label="فتح القائمة" aria-expanded={open}>
          <Menu size={21} />
        </button>
        <Link href="/dashboard" className="mobile-brand"><CircleGauge size={20} /> معتز AI</Link>
        <div className="mobile-bar-actions"><button className="icon-button" type="button" aria-label="بحث"><Search size={18} /></button><ThemeButton /></div>
      </header>
      <div className={`mobile-drawer${open ? " mobile-drawer-open" : ""}`} aria-hidden={!open}>
        <button className="drawer-backdrop" type="button" onClick={() => setOpen(false)} aria-label="إغلاق القائمة" />
        <div className="drawer-panel">
          <button className="drawer-close icon-button" type="button" onClick={() => setOpen(false)} aria-label="إغلاق القائمة"><X size={20} /></button>
          <Sidebar session={session} activePath={activePath} close={() => setOpen(false)} />
        </div>
      </div>
      <div className="desktop-utility">
        <label className="dashboard-search">
          <Search size={17} aria-hidden="true" />
          <input type="search" placeholder="ابحث في مساحة العمل…" aria-label="البحث في مساحة العمل" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="utility-actions"><ThemeButton /><span className="utility-separator" /><span className="role-badge"><KeyRound size={14} /> {session.role ?? "viewer"}</span></div>
      </div>
    </>
  );
}
