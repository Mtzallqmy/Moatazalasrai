"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  HardDrive,
  Link2,
  MessageSquareText,
  PlayCircle,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
  Users,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card, Select } from "@/components/ui";

type Overview = {
  period: { days: number; comparisonRunsPercent: number | null };
  agents: { total: number; published: number; draft: number; archived: number };
  conversations: number;
  runs: { total: number; completed: number; failed: number; cancelled: number; inputTokens: number; outputTokens: number };
  sandbox: { enabled: boolean; activeWorkspaces: number; activeExecutions: number };
  browser: { enabled: boolean; activeTasks: number };
  connections: { total: number; verified: number; failed: number };
  approvalsPending: number;
  members: number;
  recentErrors: Array<{ id: string; action: string; resourceType: string; createdAt: string }>;
  recentActivity: Array<{ id: string; action: string; resourceType: string; actorType: string; createdAt: string }>;
  health: { database: string; databaseLatencyMs: number; workerActive: boolean; workerLastSeenAt: string | null; storageDriver: string };
};
type Envelope<T> = { success: true; data: T } | { success: false; error: { message: string } };

function compact(value: number) {
  return new Intl.NumberFormat("ar", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("ar", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

export function DashboardOperationsOverview() {
  const pathname = usePathname();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/dashboard/operations-overview?days=${days}`, { cache: "no-store" });
      const payload = await response.json() as Envelope<Overview>;
      if (!response.ok || !payload.success) throw new Error(payload.success ? "فشل الطلب." : payload.error.message);
      setData(payload.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل مؤشرات التشغيل."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (pathname === "/dashboard") void load(); }, [pathname, days]);
  if (pathname !== "/dashboard") return null;

  const maxRuns = Math.max(1, data?.runs.total ?? 1);
  const cards = data ? [
    { label: "الوكلاء", value: data.agents.total, detail: `${data.agents.published} منشور`, href: "/dashboard/agents", icon: Bot },
    { label: "المحادثات", value: data.conversations, detail: `آخر ${days} يومًا`, href: "/dashboard/chat", icon: MessageSquareText },
    { label: "التشغيلات", value: data.runs.total, detail: data.period.comparisonRunsPercent === null ? "لا توجد فترة سابقة" : `${data.period.comparisonRunsPercent >= 0 ? "+" : ""}${data.period.comparisonRunsPercent}%`, href: "/dashboard/runs", icon: PlayCircle },
    { label: "الموافقات", value: data.approvalsPending, detail: "تحتاج قرارًا", href: "/dashboard/approvals", icon: ShieldCheck },
    { label: "Sandbox النشطة", value: data.sandbox.activeWorkspaces, detail: `${data.sandbox.activeExecutions} أمر نشط`, href: "/dashboard/sandbox", icon: TerminalSquare },
    { label: "مهام المتصفح", value: data.browser.activeTasks, detail: "قيد المعالجة", href: "/dashboard/browser-tasks", icon: Activity },
    { label: "الاتصالات", value: data.connections.total, detail: `${data.connections.verified} موثّق`, href: "/dashboard/site-connections", icon: Link2 },
    { label: "أعضاء المؤسسة", value: data.members, detail: "حسب المؤسسة النشطة", href: "/dashboard/members", icon: Users },
  ] : [];

  return <section className="mx-auto mt-6 w-full max-w-[1600px] space-y-5 px-4 pb-8 sm:px-6 lg:px-8" aria-label="مركز التشغيل">
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="eyebrow">مركز التشغيل</p><h2 className="mt-2 text-2xl font-extrabold">صحة المنصة ونشاط المؤسسة</h2><p className="mt-2 text-sm text-[var(--muted)]">مؤشرات تشغيل حقيقية، وليست بيانات ثابتة.</p></div>
        <div className="flex gap-2"><Select className="w-36" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 أيام</option><option value={30}>30 يومًا</option><option value={90}>90 يومًا</option></Select><Button variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} size={16} /> تحديث</Button></div>
      </div>
    </Card>
    {error ? <div role="alert" className="rounded-2xl border border-red-300/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200"><CircleAlert className="me-2 inline" size={18} />{error}</div> : null}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{loading && !data ? Array.from({ length: 8 }).map((_, index) => <Card key={index} className="h-32 animate-pulse bg-[var(--panel-muted)]" />) : cards.map(({ label, value, detail, href, icon: Icon }) => <Link key={label} href={href}><Card className="h-full p-5 transition hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-lg"><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-extrabold">{compact(value)}</p><p className="mt-2 text-xs text-[var(--muted)]">{detail}</p></div><span className="rounded-2xl bg-[var(--primary-soft)] p-3 text-[var(--primary-strong)]"><Icon size={22} /></span></div></Card></Link>)}</div>
    {data ? <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Card className="p-5 sm:p-6"><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold">نتائج التشغيل</h3><p className="text-sm text-[var(--muted)]">التوزيع خلال الفترة المحددة</p></div><Badge tone={data.runs.failed ? "warning" : "success"}>{data.runs.failed ? `${data.runs.failed} فشل` : "لا توجد أخطاء"}</Badge></div><div className="mt-6 space-y-4">{[
        { label: "مكتملة", value: data.runs.completed, className: "bg-emerald-500" },
        { label: "فاشلة", value: data.runs.failed, className: "bg-red-500" },
        { label: "ملغاة", value: data.runs.cancelled, className: "bg-slate-400" },
      ].map((item) => <div key={item.label}><div className="mb-1 flex justify-between text-sm"><span>{item.label}</span><strong>{compact(item.value)}</strong></div><div className="h-3 overflow-hidden rounded-full bg-[var(--panel-muted)]"><div className={`h-full ${item.className}`} style={{ width: `${Math.max(item.value ? 4 : 0, (item.value / maxRuns) * 100)}%` }} /></div></div>)}</div><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[var(--panel-muted)] p-4"><p className="text-xs text-[var(--muted)]">Input tokens</p><p className="mt-1 text-xl font-bold">{compact(data.runs.inputTokens)}</p></div><div className="rounded-xl bg-[var(--panel-muted)] p-4"><p className="text-xs text-[var(--muted)]">Output tokens</p><p className="mt-1 text-xl font-bold">{compact(data.runs.outputTokens)}</p></div></div></Card>
      <Card className="p-5 sm:p-6"><h3 className="text-lg font-bold">صحة الخدمات</h3><div className="mt-5 space-y-3">{[
        { label: "PostgreSQL", ok: data.health.database === "ready", detail: `${data.health.databaseLatencyMs}ms`, icon: Database },
        { label: "Graphile Worker", ok: data.health.workerActive, detail: date(data.health.workerLastSeenAt), icon: ServerCog },
        { label: "التخزين", ok: true, detail: data.health.storageDriver.toUpperCase(), icon: HardDrive },
      ].map(({ label, ok, detail, icon: Icon }) => <div key={label} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3"><span className={`rounded-xl p-2 ${ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}><Icon size={19} /></span><div className="min-w-0 flex-1"><p className="font-semibold">{label}</p><p className="truncate text-xs text-[var(--muted)]">{detail}</p></div>{ok ? <CheckCircle2 size={18} className="text-emerald-600" /> : <XCircle size={18} className="text-red-600" />}</div>)}</div></Card>
    </div> : null}
    {data ? <div className="grid gap-5 xl:grid-cols-2"><Card className="p-5"><h3 className="font-bold">النشاط الأخير</h3><div className="mt-4 divide-y divide-[var(--border)]">{data.recentActivity.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-semibold">{item.action}</p><p className="text-xs text-[var(--muted)]">{item.resourceType} · {item.actorType}</p></div><time className="whitespace-nowrap text-xs text-[var(--muted)]">{date(item.createdAt)}</time></div>)}</div></Card><Card className="p-5"><div className="flex items-center justify-between"><h3 className="font-bold">التنبيهات والأخطاء الحديثة</h3><Link className="text-sm font-semibold text-[var(--primary-strong)]" href="/dashboard/audit">سجل التدقيق</Link></div><div className="mt-4 divide-y divide-[var(--border)]">{data.recentErrors.length ? data.recentErrors.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div className="flex items-start gap-2"><CircleAlert size={17} className="mt-0.5 text-red-600" /><div><p className="font-semibold">{item.action}</p><p className="text-xs text-[var(--muted)]">{item.resourceType}</p></div></div><time className="whitespace-nowrap text-xs text-[var(--muted)]">{date(item.createdAt)}</time></div>) : <p className="py-8 text-center text-sm text-[var(--muted)]">لا توجد أخطاء حديثة.</p>}</div></Card></div> : null}
  </section>;
}
