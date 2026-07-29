"use client";

import { useCallback, useEffect, useState } from "react";
import { Braces, CheckCircle2, RefreshCw, Server, Trash2, Wrench } from "lucide-react";

type ServerRow = {
  id: string;
  name: string;
  endpoint: string;
  tokenHint: string | null;
  status: string;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  lastConnectedAt: string | null;
  lastErrorCode: string | null;
};
type ToolRow = {
  id: string;
  serverId: string;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown>;
  risk: string;
};

export function McpManager() {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard/mcp", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر تحميل MCP.");
    setServers(payload.data.servers);
    setTools(payload.data.tools);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((error) => setMessage(error.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "فشلت العملية.");
      await load();
      setMessage(body.action === "call" ? "اكتمل تنفيذ الأداة بنجاح." : "تم تحديث اتصال MCP واكتشاف الأدوات.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشلت العملية.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(serverId: string) {
    if (!window.confirm("حذف اتصال MCP وأدواته؟")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/dashboard/mcp?serverId=${serverId}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر الحذف.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر الحذف.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="dashboard-panel p-4 sm:p-5" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void action({
          action: "create",
          name: String(form.get("name") ?? ""),
          endpoint: String(form.get("endpoint") ?? ""),
          bearerToken: String(form.get("token") ?? "") || undefined,
        }).then(() => event.currentTarget.reset());
      }}>
        <div className="mb-4 flex items-start gap-3">
          <span className="metric-icon"><Server size={18} /></span>
          <div><h2 className="font-extrabold">اتصال Streamable HTTP جديد</h2><p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>اتصال MCP حقيقي مع initialize واكتشاف tools عبر SDK الرسمي.</p></div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[.7fr_1.4fr_1fr_auto]">
          <input className="form-control min-w-0" name="name" required placeholder="اسم الاتصال" />
          <input className="form-control min-w-0 font-latin" name="endpoint" type="url" required dir="ltr" placeholder="https://server.example/mcp" />
          <input className="form-control min-w-0 font-latin" name="token" type="password" dir="ltr" placeholder="Bearer token (اختياري)" />
          <button className="primary-button" disabled={busy} type="submit">ربط واكتشاف</button>
        </div>
      </form>

      {message ? <p className="rounded-xl border p-3 text-sm" role="status" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
        <section className="dashboard-panel">
          <div className="panel-header"><div><h2>الخوادم المتصلة</h2><p>{servers.length} اتصال مسجل</p></div><Braces size={18} /></div>
          {servers.length === 0 ? <div className="empty-state">لا توجد خوادم MCP بعد.</div> : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {servers.map((server) => (
                <article className="p-4" key={server.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{server.name}</h3><span className={`status-chip ${server.status === "connected" ? "status-completed" : "status-failed"}`}>{server.status === "connected" ? "متصل" : "غير متصل"}</span></div>
                      <p className="mt-2 truncate font-latin text-xs" dir="ltr" style={{ color: "var(--text-secondary)" }}>{server.endpoint}</p>
                      <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>{server.serverName ?? "MCP Server"} {server.serverVersion ? `· ${server.serverVersion}` : ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="icon-button" disabled={busy} type="button" onClick={() => action({ action: "sync", serverId: server.id })} aria-label="إعادة اكتشاف الأدوات"><RefreshCw size={16} /></button>
                      <button className="icon-button" disabled={busy} type="button" onClick={() => remove(server.id)} aria-label="حذف الاتصال"><Trash2 size={16} /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="panel-header"><div><h2>الأدوات المكتشفة</h2><p>{tools.length} أداة قابلة للربط بالوكلاء</p></div><Wrench size={18} /></div>
          {tools.length === 0 ? <div className="empty-state">ستظهر الأدوات بعد نجاح الاكتشاف.</div> : (
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {tools.map((tool) => (
                <article className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }} key={tool.id}>
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-latin text-sm font-bold" dir="ltr">{tool.title || tool.name}</h3><p className="mt-2 text-xs leading-6" style={{ color: "var(--text-secondary)" }}>{tool.description || "أداة MCP مكتشفة من الخادم."}</p></div><CheckCircle2 size={17} style={{ color: "var(--success)" }} /></div>
                  <button className="secondary-button mt-4 w-full px-3 py-2 text-xs" disabled={busy} type="button" onClick={() => action({ action: "call", toolId: tool.id, arguments: {} })}>اختبار بمدخل فارغ</button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
