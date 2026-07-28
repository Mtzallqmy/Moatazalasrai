import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { platformIdentity } from "@/lib/platform/identity";

type SessionSummary = {
  name: string | null;
  email: string;
  organizationName: string | null;
  role: string | null;
};

const navigation = [
  { label: "نظرة عامة", href: "/dashboard" },
  { label: "المزودون والنماذج", href: "/dashboard/providers" },
  { label: "الوكلاء", href: "/dashboard/agents" },
  { label: "الدردشة", href: "/dashboard/chat" },
  { label: "عمليات التشغيل", href: "/dashboard/runs" },
  { label: "التشخيص", href: "/dashboard/diagnostics" },
] as const;

export function DashboardShell({ session, activePath, title, description, children }: {
  session: SessionSummary;
  activePath: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="app-shell">
      <div className="mx-auto grid min-h-screen max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[260px_1fr] lg:px-6">
        <aside className="glass-panel rounded-3xl p-4 lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)]">
          <div className="border-b border-stone-700/70 px-2 pb-5">
            <p className="font-latin text-sm font-bold tracking-wide text-emerald-100" dir="ltr">{platformIdentity.productName}</p>
            <p className="mt-2 text-xs leading-5 text-stone-400">{session.organizationName ?? "المؤسسة"}</p>
          </div>
          <nav className="mt-5 grid grid-cols-2 gap-2 text-sm lg:grid-cols-1">
            {navigation.map((item) => {
              const active = activePath === item.href;
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`rounded-2xl px-3 py-2.5 transition ${active ? "bg-emerald-100/15 text-emerald-100" : "text-stone-300 hover:bg-stone-800/80 hover:text-white"}`}>{item.label}</Link>;
            })}
          </nav>
          <div className="mt-6 border-t border-stone-700/70 pt-4">
            <p className="truncate text-sm font-semibold">{session.name || session.email}</p>
            <p className="mt-1 truncate font-latin text-xs text-stone-500" dir="ltr">{session.email}</p>
            <p className="mt-1 text-xs text-stone-500">{session.role ?? "viewer"}</p>
            <div className="mt-4"><LogoutButton /></div>
          </div>
        </aside>
        <section className="min-w-0">
          <header className="glass-panel rounded-3xl p-5 sm:p-7">
            <h1 className="text-2xl font-black sm:text-3xl">{title}</h1>
            {description ? <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-400">{description}</p> : null}
          </header>
          <div className="py-5">{children}</div>
          <footer className="mt-4 border-t border-stone-700/70 py-6 text-center text-sm text-stone-500">برمجة وتطوير معتز العلقمي</footer>
        </section>
      </div>
    </main>
  );
}
