"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleGauge,
  FileText,
  Grid2X2,
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
  ShieldCheck,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { can, type Permission, type Role } from "@/lib/auth/permissions";

const DashboardNavigationOverlays = dynamic(() => import("@/components/dashboard-navigation-overlays").then((module) => module.DashboardNavigationOverlays));

export type DashboardSession = {
  userId?: string;
  name: string | null;
  email: string;
  organizationId: string | null;
  organizationName: string | null;
  role: Role | null;
  accessExpiresAt?: string | null;
  permissions?: Permission[];
};

export type NavigationIcon = "home" | "chat" | "agent" | "run" | "integration" | "content" | "operation" | "admin";
export type NavigationItem = {
  label: string;
  href: string;
  icon: NavigationIcon;
  permission?: Permission;
  exact?: boolean;
  keywords?: string[];
};
export type NavigationSection = { label: string; items: NavigationItem[] };

const iconComponents: Record<NavigationIcon, LucideIcon> = {
  home: Home,
  chat: MessageSquare,
  agent: Bot,
  run: PlayCircle,
  integration: Radio,
  content: FileText,
  operation: ShieldCheck,
  admin: Settings,
};

const navigationGroups: NavigationSection[] = [
  { label: "مساحة العمل", items: [
    { label: "الرئيسية", href: "/dashboard", icon: "home", exact: true, keywords: ["نظرة عامة", "dashboard"] },
    { label: "المحادثات", href: "/dashboard/chat", icon: "chat", permission: "agents:run", keywords: ["رسائل", "chat"] },
    { label: "الوكلاء", href: "/dashboard/agents", icon: "agent", permission: "agents:read", keywords: ["agents"] },
    { label: "الفرق", href: "/dashboard/teams", icon: "agent", permission: "agents:run" },
    { label: "التشغيلات", href: "/dashboard/runs", icon: "run", permission: "runs:read", keywords: ["runs", "تنفيذ"] },
  ] },
  { label: "التكاملات", items: [
    { label: "القنوات", href: "/dashboard/channels", icon: "integration", permission: "channels:read", keywords: ["WhatsApp", "Telegram", "Webhook"] },
    { label: "التكاملات", href: "/dashboard/integrations", icon: "integration", permission: "integrations:read" },
    { label: "المستودعات", href: "/dashboard/repositories", icon: "integration", permission: "integrations:read", keywords: ["GitHub", "code"] },
    { label: "المزودون والنماذج", href: "/dashboard/providers", icon: "integration", permission: "providers:read", keywords: ["models", "AI"] },
    { label: "MCP", href: "/dashboard/mcp", icon: "integration", permission: "providers:manage" },
  ] },
  { label: "المحتوى والمعرفة", items: [
    { label: "إدارة المحتوى", href: "/dashboard/content", icon: "content", permission: "content:read", keywords: ["CMS", "pages", "services", "menus"] },
    { label: "الملفات", href: "/dashboard/files", icon: "content", permission: "files:read" },
    { label: "قواعد المعرفة", href: "/dashboard/knowledge", icon: "content", permission: "files:read", keywords: ["RAG", "documents"] },
  ] },
  { label: "التشغيل والبنية", items: [
    { label: "موافقات الأدوات", href: "/dashboard/approvals", icon: "operation", permission: "runs:read" },
    { label: "مهام المتصفح", href: "/dashboard/browser-tasks", icon: "operation", permission: "browser_tasks:read" },
    { label: "Sandbox", href: "/dashboard/sandbox", icon: "operation", permission: "sandbox:read" },
  ] },
  { label: "الإدارة", items: [
    { label: "تحكم المؤسسة", href: "/dashboard/control-plane", icon: "admin", permission: "control_plane:read", keywords: ["modules", "features", "notifications", "trash"] },
    { label: "الأعضاء والصلاحيات", href: "/dashboard/members", icon: "admin", permission: "members:read" },
    { label: "سجل التدقيق", href: "/dashboard/audit", icon: "admin", permission: "audit:read" },
    { label: "صحة المنصة", href: "/dashboard/diagnostics", icon: "admin", permission: "audit:read" },
    { label: "الإعدادات", href: "/dashboard/settings", icon: "admin" },
  ] },
];

const primaryMobile: Array<Pick<NavigationItem, "label" | "href" | "icon" | "permission" | "exact">> = [
  { label: "الرئيسية", href: "/dashboard", icon: "home", exact: true },
  { label: "المحادثات", href: "/dashboard/chat", icon: "chat", permission: "agents:run" },
  { label: "الوكلاء", href: "/dashboard/agents", icon: "agent", permission: "agents:read" },
  { label: "التشغيلات", href: "/dashboard/runs", icon: "run", permission: "runs:read" },
];

const moreSections = [
  { label: "مساحة العمل", hrefs: ["/dashboard/teams", "/dashboard/files", "/dashboard/knowledge"] },
  { label: "التكاملات", hrefs: ["/dashboard/mcp", "/dashboard/providers", "/dashboard/channels", "/dashboard/integrations"] },
  { label: "النظام", hrefs: ["/dashboard/sandbox", "/dashboard/approvals", "/dashboard/audit", "/dashboard/settings"] },
] as const;

function itemAllowed(item: Pick<NavigationItem, "permission">, session: DashboardSession) {
  return !item.permission || can(session.role, item.permission) || Boolean(session.permissions?.includes(item.permission));
}

function itemActive(item: Pick<NavigationItem, "href" | "exact">, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function ThemeButton() {
  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("moataz-theme", next ? "dark" : "light");
  }
  return <button className="icon-button" type="button" onClick={toggle} aria-label="تبديل المظهر" title="تبديل المظهر"><Moon className="theme-icon-light" size={18} aria-hidden="true" /><Sun className="theme-icon-dark" size={18} aria-hidden="true" /></button>;
}

function Sidebar({ session, pathname, close }: { session: DashboardSession; pathname: string; close?: () => void }) {
  return <aside className="dashboard-sidebar" aria-label="التنقل الرئيسي">
    <div className="sidebar-brand"><span className="sidebar-logo" aria-hidden="true"><Network size={22} /></span><div><strong>معتز <bdi dir="ltr">AI</bdi></strong><span>مساحة العمل الذكية</span></div></div>
    <div className="workspace-switcher"><span className="workspace-avatar">{(session.organizationName || "م").slice(0, 1)}</span><span className="min-w-0"><b>مساحة العمل</b><small>{session.organizationName ?? "المؤسسة"}</small></span><span className="workspace-status-dot" aria-label="مساحة العمل النشطة" /></div>
    <nav className="sidebar-nav">
      {navigationGroups.map((group) => {
        const items = group.items.filter((item) => itemAllowed(item, session));
        if (!items.length) return null;
        return <div className="sidebar-nav-group" key={group.label}><p className="nav-section-label">{group.label}</p>{items.map((item) => {
          const Icon = iconComponents[item.icon];
          const active = itemActive(item, pathname);
          return <Link key={item.href} href={item.href} prefetch={item.href === "/dashboard/chat"} onClick={close} aria-current={active ? "page" : undefined} className={`sidebar-link${active ? " sidebar-link-active" : ""}`}><Icon size={18} strokeWidth={1.9} aria-hidden="true" /><span>{item.label}</span></Link>;
        })}</div>;
      })}
    </nav>
    <div className="sidebar-account"><div className="account-avatar">{(session.name || session.email).slice(0, 1).toUpperCase()}</div><div className="min-w-0"><b>{session.name || "الحساب"}</b><bdi dir="ltr">{session.email}</bdi></div><LogoutButton /></div>
  </aside>;
}

export function DashboardNavigation({ session, activePath }: { session: DashboardSession; activePath: string }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname() || activePath;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const allowedNavigation = useMemo(() => navigationGroups.flatMap((group) => group.items).filter((item) => itemAllowed(item, session)), [session]);
  const navigationByHref = useMemo(() => new Map(allowedNavigation.map((item) => [item.href, item])), [allowedNavigation]);
  const mobileItems = useMemo(() => primaryMobile.filter((item) => itemAllowed(item, session)), [session]);
  const moreGroups = useMemo(() => moreSections.map((section) => ({ label: section.label, items: section.hrefs.map((href) => navigationByHref.get(href)).filter((item): item is NavigationItem => Boolean(item)) })).filter((section) => section.items.length > 0), [navigationByHref]);
  const moreActive = moreGroups.some((section) => section.items.some((item) => itemActive(item, pathname)));

  useEffect(() => {
    if (!drawerOpen) return;
    const menuButton = menuButtonRef.current;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => { window.clearTimeout(focusTimer); document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); menuButton?.focus(); };
  }, [drawerOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") { setSearchOpen(false); setMoreOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <>
    <div className="desktop-sidebar"><Sidebar session={session} pathname={pathname} /></div>
    <header className="mobile-dashboard-bar"><button ref={menuButtonRef} className="icon-button" type="button" onClick={() => setDrawerOpen(true)} aria-label="فتح القائمة" aria-expanded={drawerOpen}><Menu size={21} aria-hidden="true" /></button><Link href="/dashboard" prefetch className="mobile-brand"><CircleGauge size={20} aria-hidden="true" /> معتز <bdi dir="ltr">AI</bdi></Link><button className="icon-button" type="button" aria-label="البحث في مساحة العمل" onClick={() => setSearchOpen(true)}><Search size={19} aria-hidden="true" /></button></header>

    {drawerOpen ? <div className="mobile-drawer mobile-drawer-open"><button className="drawer-backdrop" type="button" onClick={() => setDrawerOpen(false)} aria-label="إغلاق القائمة" /><div className="drawer-panel" role="dialog" aria-modal="true" aria-label="التنقل"><button ref={closeButtonRef} className="drawer-close icon-button" type="button" onClick={() => setDrawerOpen(false)} aria-label="إغلاق القائمة"><X size={20} /></button><Sidebar session={session} pathname={pathname} close={() => setDrawerOpen(false)} /><div className="drawer-organization-switcher"><OrganizationSwitcher activeOrganizationId={session.organizationId} /></div></div></div> : null}

    <div className="desktop-utility"><button className="dashboard-search" type="button" onClick={() => setSearchOpen(true)}><Search size={17} aria-hidden="true" /><span>ابحث في المحادثات والوكلاء والملفات…</span><kbd>⌘ K</kbd></button><div className="utility-actions"><OrganizationSwitcher activeOrganizationId={session.organizationId} /><ThemeButton /><span className="utility-separator" /><span className="role-badge"><KeyRound size={14} /> {session.role ?? "viewer"}</span></div></div>

    <nav className="mobile-bottom-nav" aria-label="التنقل السريع">{mobileItems.map((item) => { const Icon = iconComponents[item.icon]; const active = itemActive(item, pathname); return <Link href={item.href} prefetch={item.href === "/dashboard/chat" || item.href === "/dashboard"} key={item.href} aria-current={active ? "page" : undefined} className={active ? "mobile-bottom-link-active" : undefined}><Icon size={20} aria-hidden="true" /><span>{item.label}</span></Link>; })}<button type="button" className={moreActive || moreOpen ? "mobile-bottom-link-active" : undefined} onClick={() => setMoreOpen(true)} aria-label="المزيد" aria-expanded={moreOpen}><Grid2X2 size={20} aria-hidden="true" /><span>المزيد</span></button></nav>

    {searchOpen || moreOpen ? <DashboardNavigationOverlays searchOpen={searchOpen} moreOpen={moreOpen} pathname={pathname} navigation={allowedNavigation} moreGroups={moreGroups} onCloseSearch={() => setSearchOpen(false)} onCloseMore={() => setMoreOpen(false)} /> : null}
  </>;
}
