"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, FileSearch, FileText, MessageSquare, Moon, PlayCircle, Search, Sun, X } from "lucide-react";
import type { NavigationItem, NavigationSection } from "@/components/dashboard-navigation";

type SearchEntity = { id: string; title: string; subtitle: string | null; href: string; updatedAt: string | null };
type SearchGroups = Record<"conversations" | "agents" | "files" | "runs" | "knowledge", SearchEntity[]>;
type SearchPayload = { success?: boolean; data?: { groups: SearchGroups }; error?: { message?: string } };
const emptyResults = (): SearchGroups => ({ conversations: [], agents: [], files: [], runs: [], knowledge: [] });
const searchGroupLabels = [
  { key: "conversations", label: "المحادثات", icon: MessageSquare },
  { key: "agents", label: "الوكلاء", icon: Bot },
  { key: "files", label: "الملفات", icon: FileText },
  { key: "runs", label: "التشغيلات", icon: PlayCircle },
  { key: "knowledge", label: "قواعد المعرفة", icon: FileSearch },
] as const;

function itemActive(item: Pick<NavigationItem, "href" | "exact">, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function ThemeAction() {
  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("moataz-theme", next ? "dark" : "light");
  }
  return <button className="more-sheet-action" type="button" onClick={toggle}><Moon className="theme-icon-light" size={18} /><Sun className="theme-icon-dark" size={18} /><span>تبديل المظهر</span></button>;
}

export function DashboardNavigationOverlays({ searchOpen, moreOpen, pathname, navigation, moreGroups, onCloseSearch, onCloseMore }: {
  searchOpen: boolean;
  moreOpen: boolean;
  pathname: string;
  navigation: NavigationItem[];
  moreGroups: NavigationSection[];
  onCloseSearch: () => void;
  onCloseMore: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [entityResults, setEntityResults] = useState<SearchGroups>(emptyResults);
  const normalizedQuery = query.trim();
  const navigationResults = useMemo(() => normalizedQuery.length < 2
    ? navigation.slice(0, 8)
    : navigation.filter((item) => [item.label, ...(item.keywords ?? [])].join(" ").toLocaleLowerCase("ar").includes(normalizedQuery.toLocaleLowerCase("ar"))).slice(0, 5), [navigation, normalizedQuery]);
  const entityCount = Object.values(entityResults).reduce((sum, items) => sum + items.length, 0);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || normalizedQuery.length < 2) return;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchState("loading");
      try {
        const response = await fetch(`/api/dashboard/search?q=${encodeURIComponent(normalizedQuery)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as SearchPayload | null;
        if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? "تعذر البحث.");
        if (requestId !== requestIdRef.current) return;
        setEntityResults(payload.data.groups);
        setSearchState("ready");
      } catch {
        if (!controller.signal.aborted && requestId === requestIdRef.current) setSearchState("error");
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [normalizedQuery, searchOpen]);

  function navigate(href: string) {
    onCloseSearch();
    onCloseMore();
    router.push(href);
  }

  return <>
    {moreOpen ? <div className="mobile-sheet-overlay" role="presentation" onMouseDown={onCloseMore}><section className="mobile-sheet" role="dialog" aria-modal="true" aria-label="المزيد" onMouseDown={(event) => event.stopPropagation()}><div className="mobile-sheet-handle" aria-hidden="true" /><header className="mobile-sheet-header"><div><h2>المزيد</h2><p>أدوات مساحة العمل والإعدادات المتقدمة.</p></div><button className="icon-button" type="button" onClick={onCloseMore} aria-label="إغلاق"><X size={19} /></button></header><div className="more-sheet-sections">{moreGroups.map((section) => <section key={section.label} className="more-sheet-section"><h3>{section.label}</h3><div className="more-sheet-grid">{section.items.map((item) => <button type="button" key={item.href} onClick={() => navigate(item.href)} className={itemActive(item, pathname) ? "more-sheet-link-active" : undefined}><span className="more-sheet-dot" aria-hidden="true" /><span>{item.label}</span></button>)}</div></section>)}<div className="more-sheet-footer"><ThemeAction /></div></div></section></div> : null}

    {searchOpen ? <div className="command-overlay" role="presentation" onMouseDown={onCloseSearch}><section className="command-palette" role="dialog" aria-modal="true" aria-label="البحث في مساحة العمل" onMouseDown={(event) => event.stopPropagation()}><div className="command-input"><Search size={19} aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => { const next = event.target.value; setQuery(next); if (next.trim().length < 2) { setSearchState("idle"); setEntityResults(emptyResults()); } }} placeholder="ابحث في المحادثات والوكلاء والملفات والتشغيلات…" aria-label="عبارة البحث" /><button type="button" onClick={onCloseSearch} aria-label="إغلاق"><X size={18} /></button></div><div className="command-results">{searchState === "loading" ? <div className="search-loading" aria-live="polite">جارٍ البحث…</div> : null}{searchState === "error" ? <div className="search-error" role="alert">تعذر البحث الآن. حاول مجددًا.</div> : null}{normalizedQuery.length >= 2 && searchState === "ready" ? searchGroupLabels.map(({ key, label, icon: Icon }) => { const items = entityResults[key]; if (!items.length) return null; return <section className="search-result-group" key={key}><h3><Icon size={15} aria-hidden="true" />{label}<span>{items.length}</span></h3>{items.map((item) => <button type="button" key={`${key}:${item.id}`} onClick={() => navigate(item.href)}><span className="search-result-copy"><b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</span></button>)}</section>; }) : null}{navigationResults.length ? <section className="search-result-group search-navigation-group"><h3><Search size={15} aria-hidden="true" />{normalizedQuery.length >= 2 ? "صفحات" : "انتقال سريع"}</h3>{navigationResults.map((item) => <button type="button" key={item.href} onClick={() => navigate(item.href)}><span>{item.label}</span></button>)}</section> : null}{normalizedQuery.length >= 2 && searchState === "ready" && entityCount === 0 && navigationResults.length === 0 ? <p>لا توجد نتائج مطابقة.</p> : null}</div></section></div> : null}
  </>;
}
