"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Link2, Menu, ShieldCheck, TerminalSquare, X } from "lucide-react";
import { useState } from "react";

export function AutomationQuickNav({ browserEnabled, sandboxEnabled, connectionsEnabled }: {
  browserEnabled: boolean;
  sandboxEnabled: boolean;
  connectionsEnabled: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    ...(connectionsEnabled ? [{ href: "/dashboard/site-connections", label: "الحسابات المتصلة", icon: Link2 }] : []),
    ...(browserEnabled ? [{ href: "/dashboard/browser-tasks", label: "مهام المتصفح", icon: Bot }] : []),
    ...(sandboxEnabled ? [{ href: "/dashboard/sandbox", label: "Sandbox", icon: TerminalSquare }] : []),
    { href: "/dashboard/approvals", label: "الموافقات", icon: ShieldCheck },
  ];
  if (!browserEnabled && !sandboxEnabled && !connectionsEnabled) return null;
  return <div className="fixed bottom-4 start-4 z-30 hidden lg:block">
    {open ? <nav className="mb-2 w-60 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-2xl" aria-label="التشغيل والأتمتة">
      <div className="flex items-center justify-between px-2 py-2"><span className="text-sm font-bold">التشغيل والأتمتة</span><button type="button" className="rounded-lg p-1 text-[var(--muted)] hover:bg-[var(--panel-muted)]" onClick={() => setOpen(false)} aria-label="إغلاق"><X size={16} /></button></div>
      {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${pathname === href ? "bg-[var(--primary-soft)] text-[var(--primary-strong)]" : "text-[var(--muted)] hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"}`}><Icon size={17} />{label}</Link>)}
    </nav> : null}
    <button type="button" className="flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-3 text-sm font-extrabold text-white shadow-xl" onClick={() => setOpen((value) => !value)} aria-expanded={open}><Menu size={18} /> التشغيل</button>
  </div>;
}
