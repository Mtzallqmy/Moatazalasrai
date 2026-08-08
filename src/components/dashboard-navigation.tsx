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
  accessExpiresAt?: string | null;
  permissions?: Permission[];
};

type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  exact?: boolean;
  keywords?: string[];
};

type NavigationGroup = { label: string; items: NavigationItem[] };
type SearchEntity = { id: string; title: string; subtitle: string | null; href: string; updatedAt: string | null };
type SearchGroups = Record<"conversations" | "agents" | "files" | "runs" | "knowledge", SearchEntity[]>;
type SearchPayload = { success?: boolean; data?: { query: string; groups: SearchGroups }; error?: { message?: string } };

const navigationGroups: NavigationGroup[] = [
  {
    label: "مساحة العمل",
    items: [
      { label: "الرئيسية", href: "/dashboard", icon: Home, exact: true, keywords: ["نظرة عامة", "dashboard"] },
      { label: "المحادثات", href: "/dashboard/chat", icon: MessageSquare, permission: "agents:run", keywords: ["رسائل", "chat"] },
      { label: "الوكلاء", href: "/dashboard/agents", icon: Bot, permission: "agents:read", keywords: ["agents"] },
      { label: "الفرق", href: "/dashboard/teams", icon: Workflow, permission: "agents:run" },
      { label: "التشغيلات", href: "/dashboard/runs", icon: PlayCircle, permission: "runs:read", keywords: ["runs", "تنفيذ"] },
    ],
  },
  {
    label: "التكاملات",
    items: [
      { label: "القنوات", href: "/dashboard/channels", icon: Radio, permission: "channels:read", keywords: ["WhatsApp", "Telegram", "Webhook"] },
      { label: "التكاملات", href: "/dashboard/integrations", icon: Boxes, permission: "integrations:read" },
      { label: "المستودعات", href: "/dashboard/repositories", icon: FolderGit2, permission: "integrations:read", keywords: ["GitHub", "code"] },
      { label: "المزودون والنماذج", href: "/dashboard/providers", icon: Database, permission: "providers:read", keywords: ["models", "AI"] },
      { label: "MCP", href: "/dashboard/mcp", icon: Braces, permission: "providers:manage" },
    ],
  },
  {
    label: "المحتوى والمعرفة",
    items: [
      { label: "إدارة المحتوى", href: "/dashboard/content", icon: FileText, permission: "content:read", keywords: ["CMS", "pages", "services", "menus"] },
      { label: "الملفات", href: "/dashboard/files", icon: FileText, permission: "files:read" },
      { label: "قواعد المعرفة", href: "/dashboard/knowledge", icon: FileSearch, permission: "files:read", keywords: ["RAG", "documents"] },
    ],
  },
  {
    label: "التشغيل والبنية",
    items: [
      { label: "موافقات الأدوات", href: "/dashboard/approvals", icon: ShieldAlert, permission: "runs:read" },
      { label: "مهام المتصفح", href: "/dashboard/browser-tasks", icon: Archive, permission: "browser_tasks:read" },
      { label: "Sandbox", href: "/dashboard/sandbox", icon: Network, permission: "sandbox:read" },
    ],
  },
  {
    label: "الإدارة",
    items: [
      { label: "تحكم المؤسسة", href: "/dashboard/control-plane", icon: SlidersHorizontal, permission: "control_plane:read", keywords: ["modules", "features", "notifications", "trash"] },
      { label: "الأعضاء والصلاحيات", href: "/dashboard/members", icon: Users, permission: "members:read" },
      { label: "سجل التدقيق", href: "/dashboard/audit", icon: ShieldCheck, permission: "audit:read" },
      { label: "صحة المنصة", href: "/dashboard/diagnostics", icon: Activity, permission: "audit:read" },
      { label: "الإعدادات", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

const primaryMobile: Array<Pick<NavigationItem, "label" | "href" | "icon" | "permission" | "exact">> = [
  { label: "الرئيسية", href: "/dashboard", icon: Home, exact: true },
  { label: "المحادثات", href: "/dashboard/chat", icon: MessageSquare, permission: "agents:run" },
  { label: "الوكلاء", href: "/dashboard/agents", icon: Bot, permission: "agents:read" },
  { label: "التشغيلات", href: "/dashboard/runs", icon: PlayCircle, permission: "runs:read" },
];

const moreSections = [
  { label: "مساحة العمل", hrefs: ["/dashboard/teams", "/dashboard/files", "/dashboard/knowledge"] },
  { label: "التكاملات", hrefs: ["/dashboard/mcp", "/dashboard/providers", "/dashboard/channels", "/dashboard/integrations"] },
  { label: "النظام", hrefs: ["/dashboard/sandbox", "/dashboard/approvals", "/dashboard/audit", "/dashboard/settings"] },
] as const;

const searchGroupLabels: Array<{ key: keyof SearchGroups; label: string; icon: LucideIcon }> = [
  { key: "conversations", label: "المحادثات", icon: MessageSquare },
  { key: "agents", label: "الوكلاء", icon: Bot },
  { key: "files", label: "الملفات", icon: FileText },
  { key: "runs", label: "التشغيلات", icon: PlayCircle },
  { key: "knowledge", label: "قواعد المعرفة", icon: FileSearch },
];

function itemAllowed(item: Pick<NavigationItem, "permission">, session: DashboardSession) {
  return !item.permission || can(session.role, item.permission) || Boolean(session.permissions?.includes(item.permission));
}

function itemActive(item: Pick<NavigationItem, "href" | "exact">, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function ThemeButton({ labelled = false }: { labelled?: boolean }) {
  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("moataz-theme", next ? "dark" : "light");
  }
  return (
    <button className={labelled ? "more-sheet-action" : "icon-button"} type="button" onClick={toggle} aria-label="تبديل المظهر" title="تبديل المظهر">
      <Moon className="theme-icon-light" size={18} aria-hidden="true" />
      <Sun className="theme-icon-dark" size={18} aria-hidden="true" />
      {labelled ? <span>تبديل المظهر</span> : null}
    </button>
  );
}

function Sidebar({ session, activePath, close }: { session: DashboardSession; activePath: string; close?: () => void }) {
  const pathname = usePathname();
  const current = pathname || activePath;
  return (
    <aside className="dashboard-sidebar" aria-label="التنقل الرئيسي">
      <div className="sidebar-brand">
        <span className="sidebar-logo" aria-hidden="true"><Network size={22} /></span>
        <div>
          <strong>معتز <bdi dir="ltr">AI</bdi></strong>
          <span>مساحة العمل الذكية</span>
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
                  <Link key={item.href} href={item.href} onClick={close} aria-current={active ? "page" : undefined} className={`sidebar-link${active ? " sidebar-link-active" : ""}`}>
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
          <bdi dir="ltr">{session.email}</bdi>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}

export function DashboardNavigation({ session, activePath }: { session: DashboardSession; activePath: string }) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [entityResults, setEntityResults] = useState<SearchGroups>({ conversations: [], agents: [], files: [], runs: [], knowledge: [] });
  const router = useRouter();
  const pathname = usePathname() || activePath;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const allowedNavigation = useMemo(
    () => navigationGroups.flatMap((group) => group.items).filter((item) => itemAllowed(item, session)),
    [session],
  );
  const navigationByHref = useMemo(() => new Map(allowedNavigation.map((item) => [item.href, item])), [allowedNavigation]);
  const mobileItems = primaryMobile.filter((item) => itemAllowed(item, session));
  const moreGroups = moreSections.map((section) => ({
    label: section.label,
    items: section.hrefs.map((href) => navigationByHref.get(href)).filter((item): item is NavigationItem => Boolean(item)),
  })).filter((section) => section.items.length > 0);
  const moreActive = moreGroups.some((section) => section.items.some((item) => itemActive(item, pathname)));
  const normalizedQuery = query.trim();
  const navigationResults = normalizedQuery.length < 2
    ? allowedNavigation.slice(0, 8)
    : allowedNavigation.filter((item) => [item.label, ...(item.keywords ?? [])].join(" ").toLocaleLowerCase("ar").includes(normalizedQuery.toLocaleLowerCase("ar"))).slice(0, 5);
  const entityCount = Object.values(entityResults).reduce((sum, items) => sum + items.length, 0);
  const effectiveSearchState = normalizedQuery.length < 2 ? "idle" : searchState;

  useEffect(() => {
    if (!open) return;
    const menuButton = menuButtonRef.current;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
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
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMoreOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || normalizedQuery.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchState("loading");
      try {
        const response = await fetch(`/api/dashboard/search?q=${encodeURIComponent(normalizedQuery)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as SearchPayload | null;
        if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? "تعذر البحث.");
        setEntityResults(payload.data.groups);
        setSearchState("ready");
      } catch {
        if (controller.signal.aborted) return;
        setSearchState("error");
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, searchOpen]);

  function navigate(href: string) {
    setSearchOpen(false);
    setMoreOpen(false);
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
        <Link href="/dashboard" className="mobile-brand"><CircleGauge size={20} aria-hidden="true" /> معتز <bdi dir="ltr">AI</bdi></Link>
        <button className="icon-button" type="button" aria-label="البحث في مساحة العمل" onClick={() => setSearchOpen(true)}><Search size={19} aria-hidden="true" /></button>
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
          <span>ابحث في المحادثات والوكلاء والملفات…</span>
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
        <button type="button" className={moreActive || moreOpen ? "mobile-bottom-link-active" : undefined} onClick={() => setMoreOpen(true)} aria-label="المزيد" aria-expanded={moreOpen}>
          <Grid2X2 size={20} aria-hidden="true" />
          <span>المزيد</span>
        </button>
      </nav>

      {moreOpen ? (
        <div className="mobile-sheet-overlay" role="presentation" onMouseDown={() => setMoreOpen(false)}>
          <section className="mobile-sheet" role="dialog" aria-modal="true" aria-label="المزيد" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mobile-sheet-handle" aria-hidden="true" />
            <header className="mobile-sheet-header">
              <div><h2>المزيد</h2><p>أدوات مساحة العمل والإعدادات المتقدمة.</p></div>
              <button className="icon-button" type="button" onClick={() => setMoreOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            </header>
            <div className="more-sheet-sections">
              {moreGroups.map((section) => (
                <section key={section.label} className="more-sheet-section">
                  <h3>{section.label}</h3>
                  <div className="more-sheet-grid">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button type="button" key={item.href} onClick={() => navigate(item.href)} className={itemActive(item, pathname) ? "more-sheet-link-active" : undefined}>
                          <Icon size={19} aria-hidden="true" /><span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              <div className="more-sheet-footer"><ThemeButton labelled /></div>
            </div>
          </section>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="command-overlay" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="البحث في مساحة العمل" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-input">
              <Search size={19} aria-hidden="true" />
              <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في المحادثات والوكلاء والملفات والتشغيلات…" aria-label="عبارة البحث" />
              <button type="button" onClick={() => setSearchOpen(false)} aria-label="إغلاق"><X size={18} /></button>
            </div>
            <div className="command-results">
              {effectiveSearchState === "loading" ? <div className="search-loading" aria-live="polite">جارٍ البحث…</div> : null}
              {effectiveSearchState === "error" ? <div className="search-error" role="alert">تعذر البحث الآن. حاول مجددًا.</div> : null}
              {normalizedQuery.length >= 2 && effectiveSearchState === "ready" ? searchGroupLabels.map(({ key, label, icon: Icon }) => {
                const items = entityResults[key];
                if (!items.length) return null;
                return (
                  <section className="search-result-group" key={key}>
                    <h3><Icon size={15} aria-hidden="true" />{label}<span>{items.length}</span></h3>
                    {items.map((item) => (
                      <button type="button" key={`${key}:${item.id}`} onClick={() => navigate(item.href)}>
                        <span className="search-result-copy"><b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</span>
                      </button>
                    ))}
                  </section>
                );
              }) : null}
              {navigationResults.length ? (
                <section className="search-result-group search-navigation-group">
                  <h3><Search size={15} aria-hidden="true" />{normalizedQuery.length >= 2 ? "صفحات" : "انتقال سريع"}</h3>
                  {navigationResults.map((item) => {
                    const Icon = item.icon;
                    return <button type="button" key={item.href} onClick={() => navigate(item.href)}><Icon size={17} aria-hidden="true" /><span>{item.label}</span></button>;
                  })}
                </section>
              ) : null}
              {normalizedQuery.length >= 2 && effectiveSearchState === "ready" && entityCount === 0 && navigationResults.length === 0 ? <p>لا توجد نتائج مطابقة.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
