"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Connection = {
  id: string;
  kind: "telegram" | "whatsapp";
  name: string;
  displayAddress: string | null;
  status: string;
  enabled: boolean;
  webhookStatus: string;
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  defaultAgentId: string | null;
};

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

function statusLabel(connection: Connection) {
  if (!connection.enabled || connection.status === "disabled") return "غير مرتبط";
  if (connection.status === "pending") return "جارٍ التحقق";
  if (connection.status === "healthy" && connection.webhookStatus === "active") return "متصل";
  if (connection.status === "healthy" || connection.status === "degraded") return "غير جاهز";
  return "خطأ";
}

function webhookLabel(connection: Connection) {
  if (connection.webhookStatus === "active") return "مفعّل";
  if (connection.webhookStatus === "configured") return "مهيأ";
  return "غير مفعّل";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || !payload.data) throw new Error(payload.error?.message || "تعذرت العملية.");
  return payload.data;
}

function ChannelRow({ connection, canManage, onTest }: {
  connection: Connection;
  canManage: boolean;
  onTest: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const connected = statusLabel(connection) === "متصل";
  const settingsHref = connection.kind === "telegram" ? "/dashboard/integrations" : "/dashboard/settings";
  return (
    <div className="grid gap-3 border-b py-4 last:border-b-0 dark:border-slate-800 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] md:items-center">
      <div className="min-w-0">
        <p className="font-medium">{connection.kind === "telegram" ? "Telegram" : "WhatsApp"}</p>
        <p className="truncate text-sm text-slate-500">{connection.displayAddress || connection.name}</p>
      </div>
      <div><span className="text-xs text-slate-500">الحالة</span><p className="text-sm font-medium">{statusLabel(connection)}</p></div>
      <div><span className="text-xs text-slate-500">Webhook</span><p className="text-sm">{webhookLabel(connection)}</p></div>
      <div><span className="text-xs text-slate-500">الوكيل المرتبط</span><p className="text-sm">{connection.defaultAgentId ? "مربوط" : "غير مربوط"}</p></div>
      <div><span className="text-xs text-slate-500">آخر فحص</span><p className="text-sm">{connection.lastHealthAt ? new Date(connection.lastHealthAt).toLocaleString("ar") : "—"}</p></div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {canManage ? <button type="button" disabled={busy} className="rounded-lg border px-3 py-2 text-sm" onClick={async () => {
          setBusy(true);
          try { await onTest(connection.id); } finally { setBusy(false); }
        }}>{busy ? "جارٍ التحقق…" : "اختبار الاتصال"}</button> : null}
        <a className="rounded-lg border px-3 py-2 text-sm" href={settingsHref}>{connected ? "إدارة" : connection.kind === "telegram" ? "ربط تيليجرام" : "ربط واتساب"}</a>
      </div>
      {connection.lastErrorCode ? <p className="text-sm text-red-600 md:col-span-6">آخر خطأ: <bdi dir="ltr">{connection.lastErrorCode}</bdi></p> : null}
    </div>
  );
}

export function ChannelManager({ canManage }: { canManage: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await requestJson<{ connections: Connection[] }>("/api/dashboard/channels?mode=summary", { signal });
    setConnections(data.connections);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "تعذر تحميل القنوات.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  const byKind = useMemo(() => ({
    telegram: connections.filter((item) => item.kind === "telegram"),
    whatsapp: connections.filter((item) => item.kind === "whatsapp"),
  }), [connections]);

  async function testConnection(id: string) {
    setNotice("");
    try {
      await requestJson("/api/dashboard/channels/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "health", connectionId: id }),
      });
      await load();
      setNotice("اكتمل فحص القناة وتم تحديث حالتها الفعلية.");
    } catch (error) {
      await load().catch(() => undefined);
      setNotice(error instanceof Error ? error.message : "فشل اختبار الاتصال.");
    }
  }

  return <section className="rounded-2xl border bg-white px-5 dark:border-slate-800 dark:bg-slate-950">
    {loading ? <p className="py-6 text-sm text-slate-500">جارٍ تحميل حالة القنوات…</p> : null}
    {!loading && byKind.telegram.length === 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4 dark:border-slate-800"><div><p className="font-medium">Telegram</p><p className="text-sm text-slate-500">غير مرتبط</p></div><a href="/dashboard/integrations" className="rounded-lg border px-3 py-2 text-sm">ربط تيليجرام</a></div> : byKind.telegram.map((connection) => <ChannelRow key={connection.id} connection={connection} canManage={canManage} onTest={testConnection} />)}
    {!loading && byKind.whatsapp.length === 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4 dark:border-slate-800"><div><p className="font-medium">WhatsApp</p><p className="text-sm text-slate-500">غير مرتبط</p></div><a href="/dashboard/settings" className="rounded-lg border px-3 py-2 text-sm">ربط واتساب</a></div> : byKind.whatsapp.map((connection) => <ChannelRow key={connection.id} connection={connection} canManage={canManage} onTest={testConnection} />)}
    <div className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">Web / API</p><p className="text-sm text-slate-500">الدردشة والواجهات البرمجية تعمل مباشرة داخل المنصة.</p></div><a href="/dashboard/chat" className="rounded-lg border px-3 py-2 text-sm">فتح المحادثات</a></div>
    {notice ? <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900" role="status">{notice}</p> : null}
  </section>;
}
