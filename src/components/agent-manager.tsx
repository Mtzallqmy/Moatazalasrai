"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Bot, Copy, Edit3, History, MessageSquare, MoreHorizontal, Plus, Search, Send, Sparkles, X } from "lucide-react";
import { agentTemplates, type AgentTemplate } from "@/lib/agents/templates";
import { Alert, Button, EmptyState, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";
import { agentLifecyclePresentation, friendlyModelName, relativeTime } from "@/lib/ui/presentation";

type Provider = { id: string; name: string; provider: string; discoveredModels: string[] };
type Agent = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  model: string;
  providerCredentialId: string;
  updatedAt: string;
};
type Version = {
  id: string;
  version: number;
  providerCredentialId: string;
  model: string;
  instructions: string;
  temperatureMilli: number;
  maxOutputTokens: number;
  createdAt: string;
};
type McpTool = { id: string; name: string; title: string | null; risk: string; serverName: string; enabled: boolean };
type Details = { agent: Agent; versions: Version[]; mcpTools: McpTool[] };
type AgentMutation = { agent: Agent; version: Version };

function providerModels(providers: Provider[], providerId: string) {
  return providers.find((item) => item.id === providerId)?.discoveredModels ?? [];
}

export function AgentManager({ providers, initialAgents, canManage }: { providers: Provider[]; initialAgents: Agent[]; canManage: boolean }) {
  const router = useRouter();
  const [agents, setAgents] = useState(initialAgents);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Agent["status"]>("all");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [details, setDetails] = useState<Details | null>(null);
  const [editProviderId, setEditProviderId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const models = useMemo(() => providerModels(providers, providerId), [providerId, providers]);
  const editModels = useMemo(() => providerModels(providers, editProviderId), [editProviderId, providers]);
  const visibleAgents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ar");
    return agents.filter((agent) => (status === "all" || agent.status === status)
      && (!normalized || `${agent.name} ${agent.description ?? ""} ${agent.model}`.toLocaleLowerCase("ar").includes(normalized)));
  }, [agents, query, status]);
  const version = details?.versions[selectedVersion] ?? details?.versions[0] ?? null;

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  async function createAgent(input: Record<string, unknown>, success: string) {
    clearFeedback();
    setBusy("create");
    try {
      const result = await apiRequest<AgentMutation>("/api/dashboard/agents", { method: "POST", body: input, timeoutMs: 30_000 });
      const next: Agent = {
        id: result.agent.id,
        name: result.agent.name,
        description: result.agent.description,
        status: result.agent.status,
        currentVersion: result.agent.currentVersion,
        model: result.version.model,
        providerCredentialId: result.version.providerCredentialId,
        updatedAt: new Date().toISOString(),
      };
      setAgents((items) => [next, ...items]);
      setNotice(success);
      setCreateOpen(false);
      setTemplatesOpen(false);
      router.refresh();
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر إنشاء الوكيل."));
    } finally {
      setBusy(null);
    }
  }

  async function createFromTemplate(template: AgentTemplate) {
    const model = models[0];
    if (!providerId || !model) {
      setError("لا يوجد مزود متحقق ونموذج مكتشف يمكن استخدامه.");
      return;
    }
    await createAgent({
      name: template.name,
      description: template.description,
      providerCredentialId: providerId,
      model,
      instructions: template.instructions,
      temperature: template.temperature,
      maxOutputTokens: template.maxOutputTokens,
      publish: true,
    }, `تم إنشاء ونشر «${template.name}».`);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createAgent({
      name: data.get("name"),
      description: data.get("description"),
      providerCredentialId: providerId,
      model: data.get("model"),
      instructions: data.get("instructions"),
      temperature: Number(data.get("temperature")),
      maxOutputTokens: Number(data.get("maxOutputTokens")),
      publish: data.get("publish") === "on",
    }, "تم إنشاء الوكيل وإصداره الأول.");
  }

  async function loadDetails(agent: Agent) {
    clearFeedback();
    setBusy(agent.id);
    try {
      const result = await apiRequest<Details>(`/api/dashboard/agents?id=${encodeURIComponent(agent.id)}`);
      const normalized = {
        agent: { ...agent, ...result.agent },
        versions: result.versions.map((item) => ({ ...item, createdAt: String(item.createdAt) })),
        mcpTools: result.mcpTools ?? [],
      };
      setDetails(normalized);
      setEditProviderId(normalized.versions[0]?.providerCredentialId ?? agent.providerCredentialId);
      setSelectedVersion(0);
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر تحميل تفاصيل الوكيل."));
    } finally {
      setBusy(null);
    }
  }

  async function mutateAgent(agent: Agent, body: Record<string, unknown>, success: string) {
    clearFeedback();
    setBusy(agent.id);
    try {
      const result = await apiRequest<AgentMutation>("/api/dashboard/agents", { method: "PATCH", body: { id: agent.id, ...body }, timeoutMs: 30_000 });
      setAgents((items) => items.map((item) => item.id === agent.id ? {
        ...item,
        name: result.agent.name,
        description: result.agent.description,
        status: result.agent.status,
        currentVersion: result.agent.currentVersion,
        model: result.version.model,
        providerCredentialId: result.version.providerCredentialId,
        updatedAt: new Date().toISOString(),
      } : item));
      setNotice(success);
      setDetails(null);
      router.refresh();
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر تحديث الوكيل."));
    } finally {
      setBusy(null);
    }
  }

  async function saveMcpTools(toolId: string, enabled: boolean) {
    if (!details || !canManage) return;
    clearFeedback();
    setBusy(`mcp:${toolId}`);
    const nextTools = details.mcpTools.map((tool) => tool.id === toolId ? { ...tool, enabled } : tool);
    try {
      await apiRequest<{ agentId: string; toolIds: string[] }>("/api/dashboard/agents/mcp", {
        method: "PUT",
        body: { agentId: details.agent.id, toolIds: nextTools.filter((tool) => tool.enabled).map((tool) => tool.id) },
        timeoutMs: 30_000,
      });
      setDetails({ ...details, mcpTools: nextTools });
      setNotice("تم تحديث أدوات MCP المفعلة للوكيل.");
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر تحديث أدوات MCP."));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    const data = new FormData(event.currentTarget);
    await mutateAgent(details.agent, {
      name: data.get("name"),
      description: data.get("description"),
      providerCredentialId: editProviderId,
      model: data.get("model"),
      instructions: data.get("instructions"),
      temperature: Number(data.get("temperature")),
      maxOutputTokens: Number(data.get("maxOutputTokens")),
    }, "تم حفظ التعديل كإصدار جديد.");
  }

  async function duplicate(agent: Agent) {
    clearFeedback();
    setBusy(agent.id);
    try {
      const source = await apiRequest<Details>(`/api/dashboard/agents?id=${encodeURIComponent(agent.id)}`);
      const latest = source.versions[0];
      if (!latest) throw new Error("لا يوجد إصدار صالح للنسخ.");
      await createAgent({
        name: `${source.agent.name} — نسخة`,
        description: source.agent.description,
        providerCredentialId: latest.providerCredentialId,
        model: latest.model,
        instructions: latest.instructions,
        temperature: latest.temperatureMilli / 1000,
        maxOutputTokens: latest.maxOutputTokens,
        publish: false,
      }, "تم نسخ الوكيل كمسودة مستقلة.");
    } catch (cause) {
      setError(apiErrorMessage(cause, "تعذر نسخ الوكيل."));
      setBusy(null);
    }
  }

  return <div className="agent-workspace agent-workspace-v2">
    {error ? <Alert tone="danger">{error}</Alert> : null}
    {notice ? <Alert tone="success">{notice}</Alert> : null}

    <section className="page-section agent-list-section">
      <header className="page-section-header agent-page-heading">
        <div><h2>الوكلاء</h2><p>أنشئ الوكيل مرة، ثم استخدمه في المحادثات والتشغيلات والأدوات المرتبطة.</p></div>
        {canManage ? <div className="agent-heading-actions"><Button variant="secondary" onClick={() => setTemplatesOpen((value) => !value)}><Sparkles size={16} /> القوالب</Button><Button onClick={() => setCreateOpen(true)}><Plus size={16} /> وكيل جديد</Button></div> : null}
      </header>

      {templatesOpen && canManage ? <div className="agent-template-drawer">
        <div className="agent-template-toolbar"><Field label="المزود"><Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.provider}</option>)}</Select></Field><p>{models.length ? `${models.length} نموذج متاح` : "لا توجد نماذج متاحة"}</p></div>
        <div className="agent-template-grid">{agentTemplates.slice(0, 6).map((template) => <article key={template.id} className={`agent-template agent-template-${template.accent}`}><div className="flex items-center justify-between"><span className="template-icon">{template.icon}</span><span className="status-badge status-neutral">{template.category}</span></div><h3>{template.name}</h3><p>{template.description}</p><Button variant="secondary" size="sm" disabled={busy !== null || !models.length} onClick={() => void createFromTemplate(template)}><Sparkles size={14} /> استخدام القالب</Button></article>)}</div>
      </div> : null}

      <div className="page-section-body grid gap-4">
        <div className="agent-filterbar"><label className="file-search"><Search size={16} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو النموذج" aria-label="بحث الوكلاء" /></label><Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="تصفية دورة حياة الوكلاء"><option value="all">كل الحالات</option><option value="published">منشور</option><option value="draft">مسودة</option><option value="archived">مؤرشف</option></Select></div>
        {visibleAgents.length ? <div className="agent-compact-list">{visibleAgents.map((agent) => {
          const lifecycle = agentLifecyclePresentation[agent.status];
          return <article key={agent.id} className="agent-list-item">
            <span className="agent-avatar"><Bot size={19} /></span>
            <div className="agent-list-copy"><div className="agent-list-title"><h3>{agent.name}</h3><span className={`status-badge status-${lifecycle.tone}`}>{lifecycle.label}</span></div>{agent.description?.trim() ? <p>{agent.description}</p> : null}<div className="agent-list-meta"><span>{friendlyModelName(agent.model)}</span><span>آخر تعديل {relativeTime(agent.updatedAt)}</span></div></div>
            <div className="agent-primary-action">{agent.status === "published" ? <Link className={buttonClass({ variant: "primary", size: "sm" })} href={`/dashboard/chat?agentId=${encodeURIComponent(agent.id)}`}><MessageSquare size={14} /> محادثة</Link> : <Button variant="secondary" size="sm" onClick={() => void loadDetails(agent)} disabled={busy !== null}>فتح</Button>}</div>
            <details className="entity-menu agent-row-menu"><summary aria-label={`إجراءات ${agent.name}`}><MoreHorizontal size={18} /></summary><div><button type="button" onClick={() => void loadDetails(agent)}><Edit3 size={14} /> تعديل</button>{canManage ? <button type="button" onClick={() => void duplicate(agent)}><Copy size={14} /> نسخ</button> : null}{canManage && agent.status !== "published" ? <button type="button" onClick={() => void mutateAgent(agent, { status: "published" }, "تم نشر الوكيل.")}><Send size={14} /> نشر</button> : null}{canManage && agent.status !== "archived" ? <button type="button" onClick={() => void mutateAgent(agent, { status: "archived" }, "تمت أرشفة الوكيل.")}><Archive size={14} /> أرشفة</button> : null}</div></details>
          </article>;
        })}</div> : <EmptyState icon={<Bot size={22} />} title="لا توجد نتائج" description="غيّر البحث أو الفلتر، أو أنشئ وكيلًا جديدًا من مزود متحقق." />}
      </div>
    </section>

    {createOpen && canManage ? <dialog open className="modal-backdrop"><section className="modal-card agent-editor-modal" aria-labelledby="create-agent-title"><header className="modal-header"><div><h2 id="create-agent-title">إنشاء وكيل</h2><p>ابدأ بالأساسيات، وافتح الإعدادات المتقدمة فقط عند الحاجة.</p></div><Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} aria-label="إغلاق"><X size={18} /></Button></header><form onSubmit={submitCreate} className="agent-editor-form agent-editor-progressive">
      <fieldset><legend>الأساسيات</legend><div className="agent-fields"><Field label="الاسم" required><Input name="name" required maxLength={120} /></Field><Field label="الوصف"><Input name="description" maxLength={1000} /></Field></div></fieldset>
      <fieldset><legend>التعليمات</legend><Field label="ما الذي يجب أن يفعله الوكيل؟" required><Textarea name="instructions" required maxLength={30000} rows={8} /></Field></fieldset>
      <fieldset><legend>النموذج</legend><div className="agent-fields"><Field label="المزود"><Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select></Field><Field label="النموذج" required><Select name="model" required>{models.map((model) => <option key={model} value={model}>{friendlyModelName(model)}</option>)}</Select></Field></div></fieldset>
      <details className="agent-advanced-settings"><summary>إعدادات متقدمة</summary><div className="agent-fields"><Field label="Temperature"><Input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={0.3} /></Field><Field label="حد الإخراج"><Input name="maxOutputTokens" type="number" min={64} max={32768} defaultValue={2048} /></Field></div></details>
      <label className="chat-memory-option"><input name="publish" type="checkbox" /><span><b>نشر الوكيل بعد الإنشاء</b><small>يمكن تركه مسودة حتى تراجع الإعدادات.</small></span></label>
      <footer className="modal-actions"><Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>إلغاء</Button><Button type="submit" disabled={busy !== null || !models.length}>حفظ الوكيل</Button></footer>
    </form></section></dialog> : null}

    {details && version ? <dialog open className="modal-backdrop"><section className="modal-card agent-editor-modal" aria-labelledby="edit-agent-title"><header className="modal-header"><div><h2 id="edit-agent-title">{details.agent.name}</h2><p>الحفظ ينشئ إصدارًا جديدًا ولا يغيّر الإصدارات السابقة.</p></div><Button variant="ghost" size="sm" onClick={() => setDetails(null)} aria-label="إغلاق"><X size={18} /></Button></header><form key={`${details.agent.id}-${version.id}`} onSubmit={saveEdit} className="agent-editor-form agent-editor-progressive">
      <fieldset><legend>الأساسيات</legend><div className="agent-fields"><Field label="الاسم" required><Input name="name" defaultValue={details.agent.name} required maxLength={120} /></Field><Field label="الوصف"><Input name="description" defaultValue={details.agent.description ?? ""} maxLength={1000} /></Field></div></fieldset>
      <fieldset><legend>التعليمات</legend><Field label="تعليمات النظام"><Textarea name="instructions" defaultValue={version.instructions} required rows={8} maxLength={30000} /></Field></fieldset>
      <fieldset><legend>النموذج</legend><div className="agent-fields"><Field label="المزود"><Select value={editProviderId} onChange={(event) => setEditProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select></Field><Field label="النموذج"><Select name="model" defaultValue={editModels.includes(version.model) ? version.model : editModels[0]}>{editModels.map((model) => <option key={model} value={model}>{friendlyModelName(model)}</option>)}</Select></Field></div><code className="technical-value agent-model-slug">{version.model}</code></fieldset>
      <details className="agent-advanced-settings"><summary>إعدادات متقدمة</summary><div className="agent-fields"><Field label="Temperature"><Input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={version.temperatureMilli / 1000} /></Field><Field label="حد الإخراج"><Input name="maxOutputTokens" type="number" min={64} max={32768} defaultValue={version.maxOutputTokens} /></Field></div></details>
      <footer className="modal-actions"><Button variant="secondary" type="button" onClick={() => setDetails(null)}>إلغاء</Button><Button type="submit" disabled={busy !== null || !editModels.length}>حفظ كإصدار جديد</Button></footer>
    </form><section className="agent-version-panel"><h3>أدوات MCP المفعلة</h3>{details.mcpTools.length ? <div>{details.mcpTools.map((tool) => <label key={tool.id} className="flex items-start gap-2 py-2 text-sm"><input type="checkbox" checked={tool.enabled} disabled={!canManage || busy !== null} onChange={(event) => void saveMcpTools(tool.id, event.target.checked)} /><span><b>{tool.title || tool.name}</b><small className="block text-slate-500">{tool.serverName} · {tool.risk}</small></span></label>)}</div> : <p className="text-sm text-slate-500">لا توجد أدوات من خادم MCP متصل. <Link href="/dashboard/mcp" className="underline">إضافة خادم MCP</Link></p>}</section><section className="agent-version-panel"><h3><History size={16} /> الإصدارات</h3><div>{details.versions.map((item, index) => <button type="button" key={item.id} onClick={() => { setSelectedVersion(index); setEditProviderId(item.providerCredentialId); }} className={index === selectedVersion ? "agent-version-active" : undefined}><span>الإصدار {item.version}</span><b>{friendlyModelName(item.model)}</b><small>{relativeTime(item.createdAt)}</small></button>)}</div></section></section></dialog> : null}
  </div>;
}
