"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Maximize2, TerminalSquare, X } from "lucide-react";
import { SandboxConsole } from "@/components/sandbox-console";
import { buttonClass } from "@/components/ui";

function conversationIdFromLocation(pathname: string, searchParams: URLSearchParams) {
  const query = searchParams.get("conversationId") ?? searchParams.get("conversation");
  if (query && /^[0-9a-f-]{36}$/i.test(query)) return query;
  const match = pathname.match(/\/dashboard\/chat\/([0-9a-f-]{36})(?:\/|$)/i);
  return match?.[1] ?? null;
}

export function SandboxConversationDock() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const conversationId = conversationIdFromLocation(pathname, searchParams);
  if (!conversationId) return null;

  return <>
    <button
      type="button"
      className="fixed bottom-24 end-4 z-40 flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-2xl ring-1 ring-white/15 transition hover:-translate-y-0.5 sm:bottom-6"
      onClick={() => setOpen(true)}
      aria-label="فتح Sandbox المحادثة"
    >
      <TerminalSquare size={18} /> Sandbox
    </button>
    {open ? <div className={`fixed inset-0 z-[65] bg-slate-950/65 p-2 sm:p-4 ${expanded ? "" : "lg:ps-[min(28rem,42vw)]"}`} role="dialog" aria-modal="true" aria-label="Sandbox المحادثة">
      <section className={`ms-auto flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--panel)] shadow-2xl ${expanded ? "w-full" : "w-full lg:max-w-5xl"}`}>
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2"><TerminalSquare size={20} className="text-[var(--primary-strong)]" /><div><h2 className="font-bold">Sandbox المحادثة</h2><p className="text-xs text-[var(--muted)]">طرفية وملفات وسجل دائم للمحادثة الحالية</p></div></div>
          <div className="flex gap-1"><button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "تصغير" : "توسيع"}><Maximize2 size={16} /></button><button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setOpen(false)} aria-label="إغلاق"><X size={17} /></button></div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4"><SandboxConsole conversationId={conversationId} compact /></div>
      </section>
    </div> : null}
  </>;
}
