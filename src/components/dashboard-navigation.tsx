"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  Bot,
  Boxes,
  Braces,
  CircleGauge,
  Database,
  FileSearch,
  FileText,
  FolderGit2,
  Home,
  KeyRound,
  Menu,
  MessageSquare,
  Moon,
  Network,
  PlayCircle,
  Radio,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { can, type Permission, type Role } from "@/lib/auth/permissions";

export type DashboardSession = {
  userId?: string;
  name: string | null;
  email: string;
  organizationId: string | null;
  organizationName: string | null;
  role: Role | null;
  permissions?: Permission[];
};

type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  exact?: boolean;
  mobile?: boolean;
  keywords?: string[];
};

type NavigationGroup = { label: string; items: NavigationItem[] };

const navigationGroups: NavigationGroup[] = [
  {
    label: "مساحة العمل",
    items: [
      { label: "نظرة عامة", href: "/dashboard", icon: Home, exact: true, mobile: true, keywords: ["الرئيسية", "dashboard"] },
      { label: "المحادثات", href: "/dashboard/chat", icon: MessageSquare, permission: "agents:run", mobile: true, keywords: ["رسائل", "chat"] },
      { label: "الوكلاء", href: "/dashboard/agents", icon: Bot, permission: "agents:read", mobile: true, keywords: ["agents"] },
      { label: "فرق الوكلاء", href: "/dashboard/teams", icon: Workflow, permission: "agents:run" },
      { label: "عمليات التشغيل", href: "/dashboard/runs", icon: PlayCircle, permission: "runs:read", mobile: true, keywords: ["runs", "تنفيذ"] },
    ],
  },
  {
    label: "القنوات والتواصل",
    items: [
      { label: "القنوات وصناديق المحادثات", href: "/dashboard/channels", icon: Radio, permission: "channels:read", mobile: true, keywords: ["WhatsApp", "Telegram", "Webhook"] },
      { label: "التكاملات", href: "/dashboard/integrations", icon: Boxes, permission: "integrations:read" },
      { label: "المستودعات", href: "/dashboard/repositories", icon: FolderGit2, permission: "integrations:read", keywords: ["GitHub", "code"] },
    ],
  },
  {
    label: "المحتوى والمعرفة",
    items: [
      { label: "إدارة المحتوى", href: "/dashboard/content", icon: FileText, permission: "content:read", keywords: ["CMS", "pages", "services", "menus"] },
      { label: "الملفات", href: "/dashboard/files", icon: FileText, permission: "files:read", mobile: true },
      { label: "قواعد المعرفة", href: "/dashboard/knowledge", icon: FileSearch, permission: "files:read", keywords: ["RAG", "documents"] },
    ],
  },
  {
    label: "التشغيل والبنية التحتية",
    items: [
      { label: "موافقات الأدوات", href: "/dashboard/approvals", icon: ShieldAlert, permission: "runs:read" },
      { label: "المزودون والنماذج", href: "/dashboard/providers", icon: Database, permission: "providers:read", keywords: ["models", "AI"] },
      { label: "بوابة MCP", href: "/dashboard/mcp", icon: Braces, permission: "providers:manage" },
      { label: "مهام المتصفح", href: "/dashboard/browser-tasks", icon: Archive, permission: "browser_tasks:read" },
      { label: "بيئة التنفيذ", href: "/dashboard/sandbox", icon: Network, permission: "sandbox:read" },
    ],
  },
  {
    label: "الإدارة والحوكمة",
    items: [
      { label: "مركز تحكم المؤسسة", href: "/dashboard/control-plane", icon: SlidersHorizontal, permission: "control_plane:read", keywords: ["modules", "features", "notifications", "trash"] },
      { label: "الأعضاء والصلاحيات", href: "/dashboard/members", icon: Users, permission: "members:read" },
      { label: "سجل التدقيق", href: "/dashboard/audit", icon: ShieldCheck, permission: "audit:read" },
      { label: "صحة المنصة", href: "/dashboard/diagnostics", icon: Activity, permission: "audit:read" },
      { label: "الإعدادات", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

function itemAllowed(item: NavigationItem, session: DashboardSession) {
  return !item.permission
    || can(session.role, item.permission)
    || Boolean(session.permissions?.includes(item.permission));
}

function itemActive(item: NavigationItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function ThemeButton() {
  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("moataz-theme", next ? "dark" : "light");
  }
  return (
    <button className="icon-button" type="button" onClick={toggle} aria-label="تبديل المظهر" title="تبديل المظهر">
      <Moon className="theme-icon-light" size={18} aria-hidden="true" />
      <Sun className="theme-icon-dark" size={18} aria-hidden="true" />
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
      <div className="workspace-switcher">
        <span className="workspace-avatar">{(session.organizationName || "م").slice(0, 1)}</span>
        <span className="min-w-0">
          <b>مساحة العمل</b>
          <small>{session.organizationName ?? "المؤسسة"}</small>
        </span>
        <span className="workspace-status-dot" aria-label="مساحة العمل النشطة" />
      </div>
      <nav className="sidebar-nav">
        {navigationGroups.map((group) => {
          const items = group.items.filter((item) => itemAllowed(item, session));
          if (!items.length) return null;
          return (
            <div className="sidebar-nav-group" key={group.label}>
              <p className="nav-section-label">{group.label}</p>
              {items.map((item) => {
                const active = itemActive(item, current);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`sidebar-link${active ? " sidebar-link-active" : ""}`}
                  >
                    <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname() || activePath;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const allowedNavigation = useMemo(
    () => navigationGroups.flatMap((group) => group.items).filter((item) => itemAllowed(item, session)),
    [session],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("ar");
  const searchResults = allowedNavigation.filter((item) => {
    if (!normalizedQuery) return true;
    const haystack = [item.label, ...(item.keywords ?? [])].join(" ").toLocaleLowerCase("ar");
    return haystack.includes(normalizedQuery);
  });
  const mobileItems = allowedNavigation.filter((item) => item.mobile).slice(0, 5);

  useEffect(() => {
    if (!open) return;
    const menuButton = menuButtonRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab" && closeButtonRef.current && !document.querySelector(".drawer-panel:focus-within")) {
        event.preventDefault();
        closeButtonRef.current.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      menuButton?.focus();
    };
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen]);

  function navigate(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      <div className="desktop-sidebar"><Sidebar session={session} activePath={activePath} /></div>
      <header className="mobile-dashboard-bar">
        <button ref={menuButtonRef} className="icon-button" type="button" onClick={() => setOpen(true)} aria-label="فتح القائمة" aria-expanded={open}>
          <Menu size={21} aria-hidden="true" />
        </button>
        <Link href="/dashboard" className="mobile-brand"><CircleGauge size={20} aria-hidden="true" /> معتز AI</Link>
        <div className="mobile-bar-actions">
          <button className="icon-button" type="button" aria-label="بحث" onClick={() => setSearchOpen(true)}><Search size={18} aria-hidden="true" /></button>
          <ThemeButton />
        </div>
      </header>
      <div className={`mobile-drawer${open ? " mobile-drawer-open" : ""}`} aria-hidden={!open}>
        <button className="drawer-backdrop" type="button" onClick={() => setOpen(false)} aria-label="إغلاق القائمة" />
        <div className="drawer-panel" role="dialog" aria-modal="true" aria-label="التنقل">
          <button ref={closeButtonRef} className="drawer-close icon-button" type="button" onClick={() => setOpen(false)} aria-label="إغلاق القائمة"><X size={20} /></button>
          <Sidebar session={session} activePath={activePath} close={() => setOpen(false)} />
        </div>
      </div>
      <div className="desktop-utility">
        <button className="dashboard-search" type="button" onClick={() => setSearchOpen(true)}>
          <Search size={17} aria-hidden="true" />
          <span>ابحث في مساحة العمل…</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="utility-actions"><ThemeButton /><span className="utility-separator" /><span className="role-badge"><KeyRound size={14} /> {session.role ?? "viewer"}</span></div>
      </div>
      <nav className="mobile-bottom-nav" aria-label="التنقل السريع">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = itemActive(item, pathname);
          return (
            <Link href={item.href} key={item.href} aria-current={active ? "page" : undefined} className={active ? "mobile-bottom-link-active" : undefined}>
              <Icon size={20} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      {searchOpen ? (
        <div className="command-overlay" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="البحث في مساحة العمل" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-input">
              <Search size={19} aria-hidden="true" />
              <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اكتب اسم الصفحة أو الوظيفة…" aria-label="عبارة البحث" />
              <button type="button" onClick={() => setSearchOpen(false)} aria-label="إغلاق"><X size={18} /></button>
            </div>
            <div className="command-results">
              {searchResults.map((item) => {
                const Icon = item.icon;
                return <button type="button" key={item.href} onClick={() => navigate(item.href)}><span className="nav-icon"><Icon size={17} /></span><span>{item.label}</span></button>;
              })}
              {searchResults.length === 0 ? <p>لا توجد صفحة مطابقة.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
