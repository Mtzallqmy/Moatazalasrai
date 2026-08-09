"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Braces, Eye, EyeOff, FileText, Images, MessageSquareText, RefreshCw,
  Server, ShieldCheck, Sparkles, Trash2, Video, Wrench,
} from "lucide-react";

type ServerRow = {
  id: string; name: string; endpoint: string; authMode: string; tokenHint: string | null;
  status: string; serverName: string | null; serverVersion: string | null; enabled: boolean;
};
type ToolRow = {
  id: string; serverId: string; name: string; title: string | null; description: string | null;
  inputSchema: Record<string, unknown>; capability: string; mediaType: string | null;
  risk: "low" | "medium" | "high"; enabled: boolean;
};
type ResourceRow = { id: string; serverId: string; uri: string; name: string; title: string | null; description: string | null; mimeType: string | null; enabled: boolean };
type TemplateRow = { id: string; serverId: string; uriTemplate: string; name: string; title: string | null; description: string | null; enabled: boolean };
type PromptRow = { id: string; serverId: string; name: string; title: string | null; description: string | null; enabled: boolean };
type CatalogKind = "tool" | "resource" | "resource_template" | "prompt";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "فشلت العملية.";
}

export function McpManager() {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/dashboard/mcp", { cache: "no-store", signal });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر تحميل MCP.");
    setServers(payload.data.servers);
    setTools(payload.data.tools);
    setResources(payload.data.resources);
    setTemplates(payload.data.resourceTemplates);
    setPrompts(payload.data.prompts);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setMessage(errorMessage(error)); }), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  async function mutate(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/mcp", {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "فشلت العملية.");
      if (payload.data?.authorizationUrl) {
        window.location.assign(String(payload.data.authorizationUrl));
        return;
      }
      if (["call", "read_resource", "get_prompt"].includes(String(body.action))) {
        setPreview(JSON.stringify(payload.data.result ?? payload.data, null, 2).slice(0, 12_000));
      }
      await load();
      setMessage("تمت العملية بنجاح وسُجلت ضمن نشاط المؤسسة.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(serverId: string) {
    if (!window.confirm("حذف اتصال MCP وفهرسه؟ لا يمكن التراجع عن العملية.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/dashboard/mcp?serverId=${serverId}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر الحذف.");
      await load();
      setMessage("حُذف الاتصال.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function toggle(kind: CatalogKind, id: string, enabled: boolean) {
    return mutate("PATCH", { action: "set_catalog_enabled", kind, id, enabled });
  }

  useEffect(() => {
    const oauth = new URLSearchParams(window.location.search).get("oauth");
    if (!oauth) return;
    const timer = window.setTimeout(() => setMessage(oauth === "connected"
      ? "تم ربط Higgsfield واكتشاف الفهرس." : oauth === "cancelled"
        ? "أُلغي تسجيل الدخول إلى Higgsfield." : "تعذر إكمال OAuth."), 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4">
      <section className="dashboard-panel overflow-hidden">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex items-start gap-4"><span className="metric-icon"><Sparkles size={20} /></span><div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold">Higgsfield الرسمي</h2><span className="status-chip status-completed">OAuth 2.1 + PKCE</span></div>
            <p className="mt-2 text-sm leading-7" style={{ color: "var(--text-secondary)" }}>اتصال MCP حقيقي مع اكتشاف الأدوات والموارد والقوالب والمطالبات.</p>
          </div></div>
          <button className="primary-button" disabled={busy} type="button" onClick={() => mutate("POST", { action: "connect_higgsfield" })}><Sparkles size={16} /> ربط Higgsfield</button>
        </div>
      </section>

      <form className="dashboard-panel p-4 sm:p-5" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void mutate("POST", { action: "create", name: String(form.get("name") ?? ""), endpoint: String(form.get("endpoint") ?? ""), bearerToken: String(form.get("token") ?? "") || undefined }).then(() => event.currentTarget.reset());
      }}>
        <div className="mb-4 flex items-start gap-3"><span className="metric-icon"><Server size={18} /></span><div><h2 className="font-extrabold">اتصال Streamable HTTP مخصص</h2><p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>يدعم أي خدمة متوافقة مع MCP عبر HTTPS وبعد فحص عنوان الخادم.</p></div></div>
        <div className="grid gap-3 lg:grid-cols-[.7fr_1.4fr_1fr_auto]">
          <input className="form-control min-w-0" name="name" required placeholder="اسم الاتصال" />
          <input className="form-control min-w-0 font-latin" name="endpoint" type="url" required dir="ltr" placeholder="https://server.example/mcp" />
          <input className="form-control min-w-0 font-latin" name="token" type="password" dir="ltr" autoComplete="off" placeholder="Bearer token (اختياري)" />
          <button className="primary-button" disabled={busy} type="submit">ربط واكتشاف</button>
        </div>
      </form>

      {message ? <p className="rounded-xl border p-3 text-sm" role="status" aria-live="polite" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>{message}</p> : null}
      {preview ? <details className="dashboard-panel p-4"><summary className="cursor-pointer font-bold">معاينة النتيجة الحالية</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs" dir="ltr">{preview}</pre></details> : null}

      <section className="dashboard-panel">
        <div className="panel-header"><div><h2>الخوادم المتصلة</h2><p>{servers.length} اتصال مسجل</p></div><Braces size={18} /></div>
        {servers.length === 0 ? <div className="empty-state">لا توجد خوادم MCP بعد.</div> : <div className="divide-y" style={{ borderColor: "var(--border)" }}>{servers.map((server) => (
          <article className="p-4" key={server.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{server.name}</h3><span className={`status-chip ${server.status === "connected" && server.enabled ? "status-completed" : "status-failed"}`}>{!server.enabled ? "موقوف" : server.status === "connected" ? "متصل" : "غير متصل"}</span></div>
            <p className="mt-2 break-all font-latin text-xs" dir="ltr" style={{ color: "var(--text-secondary)" }}>{server.endpoint}</p>
          </div><div className="flex flex-wrap gap-2">
            {server.authMode === "oauth" && server.status !== "connected" && server.enabled ? <button className="secondary-button px-3 py-2 text-xs" disabled={busy} type="button" onClick={() => mutate("POST", { action: "authorize", serverId: server.id })}>تسجيل الدخول</button> : null}
            <button className="secondary-button px-3 py-2 text-xs" disabled={busy} type="button" onClick={() => mutate("PATCH", { action: "update_server", serverId: server.id, enabled: !server.enabled })}>{server.enabled ? <><EyeOff size={14} /> إيقاف</> : <><Eye size={14} /> تفعيل</>}</button>
            <button className="icon-button" disabled={busy || !server.enabled} type="button" onClick={() => mutate("POST", { action: "sync", serverId: server.id })} aria-label={`مزامنة ${server.name}`}><RefreshCw size={16} /></button>
            <button className="icon-button" disabled={busy} type="button" onClick={() => remove(server.id)} aria-label={`حذف ${server.name}`}><Trash2 size={16} /></button>
          </div></div></article>
        ))}</div>}
      </section>

      <CatalogSection title="الأدوات" subtitle={`${tools.length} أداة، والأدوات المتوسطة والعالية تُنفذ داخل الوكيل بعد الموافقة`} icon={<Wrench size={18} />}>
        {tools.map((tool) => <CatalogCard key={tool.id} title={tool.title || tool.name} description={tool.description} enabled={tool.enabled} busy={busy} onToggle={() => toggle("tool", tool.id, !tool.enabled)} badges={<>
          <span className="status-chip"><ShieldCheck size={13} /> {tool.risk}</span>
          {tool.mediaType === "video" ? <span className="status-chip"><Video size={13} /> فيديو</span> : null}
          {tool.mediaType === "image" ? <span className="status-chip"><Images size={13} /> صورة</span> : null}
        </>} action={tool.enabled && tool.risk === "low" ? <button className="secondary-button mt-3 w-full px-3 py-2 text-xs" disabled={busy} type="button" onClick={() => mutate("POST", { action: "call", toolId: tool.id, arguments: {} })}>اختبار آمن بمدخل فارغ</button> : null} />)}
      </CatalogSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <CatalogSection title="الموارد" subtitle={`${resources.length} مورد قابل للقراءة`} icon={<FileText size={18} />}>
          {resources.map((resource) => <CatalogCard key={resource.id} title={resource.title || resource.name} description={resource.description || resource.uri} enabled={resource.enabled} busy={busy} onToggle={() => toggle("resource", resource.id, !resource.enabled)} action={resource.enabled ? <button className="secondary-button mt-3 w-full px-3 py-2 text-xs" disabled={busy} type="button" onClick={() => mutate("POST", { action: "read_resource", serverId: resource.serverId, uri: resource.uri })}>قراءة المورد</button> : null} />)}
        </CatalogSection>
        <CatalogSection title="المطالبات" subtitle={`${prompts.length} قالب مطالبة`} icon={<MessageSquareText size={18} />}>
          {prompts.map((prompt) => <CatalogCard key={prompt.id} title={prompt.title || prompt.name} description={prompt.description} enabled={prompt.enabled} busy={busy} onToggle={() => toggle("prompt", prompt.id, !prompt.enabled)} action={prompt.enabled ? <button className="secondary-button mt-3 w-full px-3 py-2 text-xs" disabled={busy} type="button" onClick={() => mutate("POST", { action: "get_prompt", serverId: prompt.serverId, name: prompt.name, arguments: {} })}>معاينة القالب</button> : null} />)}
        </CatalogSection>
      </div>

      <CatalogSection title="قوالب الموارد" subtitle={`${templates.length} قالب URI؛ استخدم المورد الفعلي بعد ملء المتغيرات`} icon={<Braces size={18} />}>
        {templates.map((template) => <CatalogCard key={template.id} title={template.title || template.name} description={template.description || template.uriTemplate} enabled={template.enabled} busy={busy} onToggle={() => toggle("resource_template", template.id, !template.enabled)} />)}
      </CatalogSection>
    </div>
  );
}

function CatalogSection({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="dashboard-panel"><div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{icon}</div><div className="grid gap-3 p-4 md:grid-cols-2">{children}</div></section>;
}

function CatalogCard({ title, description, enabled, busy, onToggle, badges, action }: { title: string; description?: string | null; enabled: boolean; busy: boolean; onToggle: () => void; badges?: React.ReactNode; action?: React.ReactNode }) {
  return <article className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-soft)", opacity: enabled ? 1 : .65 }}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all font-latin text-sm font-bold" dir="ltr">{title}</h3>{badges}</div><p className="mt-2 break-all text-xs leading-6" style={{ color: "var(--text-secondary)" }}>{description || "عنصر مكتشف من خادم MCP."}</p></div><button className="icon-button shrink-0" disabled={busy} type="button" onClick={onToggle} aria-label={enabled ? `إخفاء ${title}` : `إظهار ${title}`}>{enabled ? <Eye size={16} /> : <EyeOff size={16} />}</button></div>{action}</article>;
}
