"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Bot, Copy, Edit3, History, MessageSquare, Plus, Search, Send, Sparkles, X } from "lucide-react";
import { agentTemplates, type AgentTemplate } from "@/lib/agents/templates";
import { Alert, Button, EmptyState, Field, Input, Select, StatusBadge, Textarea, buttonClass } from "@/components/ui";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";

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
type Details = { agent: Agent; versions: Version[] };
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
    }, "تم حفظ التعديل كإصدار جديد immutable.");
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

  return <div className="agent-workspace">
    {error ? <Alert tone="danger">{error}</Alert> : null}
    {notice ? <Alert tone="success">{notice}</Alert> : null}

    <section className="page-section agent-library">
      <header className="page-section-header">
        <div><h2>مكتبة الوكلاء</h2><p>القوالب تنشئ سجلات وإصدارات حقيقية باستخدام مزود متحقق.</p></div>
        {canManage ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} /> وكيل جديد</Button> : null}
      </header>
      <div className="page-section-body grid gap-4">
        {canManage ? <div className="agent-template-toolbar"><Field label="مزود القوالب"><Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.provider}</option>)}</Select></Field><p>{models.length ? `${models.length} نموذج مكتشف` : "لا توجد نماذج متاحة"}</p></div> : null}
        <div className="agent-template-grid">
          {agentTemplates.slice(0, 8).map((template) => <article key={template.id} className={`agent-template agent-template-${template.accent}`}>
            <div className="flex items-center justify-between"><span className="template-icon">{template.icon}</span><span className="status-badge status-neutral">{template.category}</span></div>
            <h3>{template.name}</h3><p>{template.description}</p>
            {canManage ? <Button variant="secondary" size="sm" disabled={busy !== null || !models.length} onClick={() => void createFromTemplate(template)}><Sparkles size={14} /> إنشاء ونشر</Button> : null}
          </article>)}
        </div>
      </div>
    </section>

    <section className="page-section">
      <header className="page-section-header"><div><h2>الوكلاء الفعليون</h2><p>{visibleAgents.length} من {agents.length}</p></div></header>
      <div className="page-section-body grid gap-4">
        <div className="agent-filterbar"><label className="file-search"><Search size={16} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو النموذج" aria-label="بحث الوكلاء" /></label><Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="تصفية حالة الوكلاء"><option value="all">كل الحالات</option><option value="published">منشور</option><option value="draft">مسودة</option><option value="archived">مؤرشف</option></Select></div>
        {visibleAgents.length ? <div className="agent-card-grid">{visibleAgents.map((agent) => <article key={agent.id} className="agent-card">
          <header><span className="agent-avatar"><Bot size={19} /></span><div><h3>{agent.name}</h3><p>{agent.description || "لا يوجد وصف"}</p></div><StatusBadge status={agent.status} label={agent.status === "published" ? "منشور" : agent.status === "draft" ? "مسودة" : "مؤرشف"} /></header>
          <dl><div><dt>النموذج</dt><dd dir="ltr">{agent.model}</dd></div><div><dt>الإصدار</dt><dd>v{agent.currentVersion}</dd></div><div><dt>آخر تعديل</dt><dd>{new Date(agent.updatedAt).toLocaleDateString("ar")}</dd></div></dl>
          <footer>
            {agent.status === "published" ? <Link className={buttonClass({ variant: "primary", size: "sm" })} href={`/dashboard/chat?agentId=${encodeURIComponent(agent.id)}`}><MessageSquare size={14} /> محادثة</Link> : null}
            <Button variant="secondary" size="sm" onClick={() => void loadDetails(agent)} disabled={busy !== null}><Edit3 size={14} /> المحرر</Button>
            {canManage ? <Button variant="ghost" size="sm" onClick={() => void duplicate(agent)} disabled={busy !== null}><Copy size={14} /> نسخ</Button> : null}
            {canManage && agent.status !== "published" ? <Button variant="secondary" size="sm" onClick={() => void mutateAgent(agent, { status: "published" }, "تم نشر إصدار ثابت جديد.")} disabled={busy !== null}><Send size={14} /> نشر</Button> : null}
            {canManage && agent.status !== "archived" ? <Button variant="ghost" size="sm" onClick={() => void mutateAgent(agent, { status: "archived" }, "تمت أرشفة الوكيل.")} disabled={busy !== null}><Archive size={14} /> أرشفة</Button> : null}
          </footer>
        </article>)}</div> : <EmptyState icon={<Bot size={22} />} title="لا توجد نتائج" description="غيّر البحث أو الفلتر، أو أنشئ وكيلًا جديدًا من مزود متحقق." />}
      </div>
    </section>

    {createOpen && canManage ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}><section className="modal-card agent-editor-modal" role="dialog" aria-modal="true" aria-labelledby="create-agent-title"><header className="modal-header"><div><h2 id="create-agent-title">إنشاء وكيل</h2><p>تُحفظ الحقول كإصدار أول في قاعدة البيانات.</p></div><Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} aria-label="إغلاق"><X size={18} /></Button></header><form onSubmit={submitCreate} className="agent-editor-form">
      <fieldset><legend>1. الهوية</legend><div className="agent-fields"><Field label="الاسم" required><Input name="name" required maxLength={120} /></Field><Field label="الوصف"><Input name="description" maxLength={1000} /></Field></div></fieldset>
      <fieldset><legend>2. النموذج</legend><div className="agent-fields"><Field label="المزود"><Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select></Field><Field label="النموذج" required><Select name="model" required>{models.map((model) => <option key={model}>{model}</option>)}</Select></Field></div></fieldset>
      <fieldset><legend>3. تعليمات النظام</legend><Field label="التعليمات" required><Textarea name="instructions" required maxLength={30000} rows={9} /></Field></fieldset>
      <fieldset><legend>4. قيود التوليد</legend><div className="agent-fields"><Field label="Temperature"><Input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={0.3} /></Field><Field label="حد الإخراج"><Input name="maxOutputTokens" type="number" min={64} max={32768} defaultValue={2048} /></Field></div><label className="chat-memory-option"><input name="publish" type="checkbox" /><span><b>نشر الإصدار فورًا</b><small>المسودة لا تظهر للمستخدمين العاديين حتى نشرها.</small></span></label></fieldset>
      <footer className="modal-actions"><Button variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Button><Button type="submit" disabled={busy !== null || !models.length}>حفظ الوكيل</Button></footer>
    </form></section></div> : null}

    {details && version ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetails(null)}><section className="modal-card agent-editor-modal" role="dialog" aria-modal="true" aria-labelledby="edit-agent-title"><header className="modal-header"><div><h2 id="edit-agent-title">محرر {details.agent.name}</h2><p>كل حفظ ينشئ إصدارًا جديدًا، ولا يعدل الإصدار السابق.</p></div><Button variant="ghost" size="sm" onClick={() => setDetails(null)} aria-label="إغلاق"><X size={18} /></Button></header><form key={`${details.agent.id}-${version.id}`} onSubmit={saveEdit} className="agent-editor-form">
      <fieldset><legend>1. الهوية</legend><div className="agent-fields"><Field label="الاسم" required><Input name="name" defaultValue={details.agent.name} required maxLength={120} /></Field><Field label="الوصف"><Input name="description" defaultValue={details.agent.description ?? ""} maxLength={1000} /></Field></div></fieldset>
      <fieldset><legend>2. النموذج</legend><div className="agent-fields"><Field label="المزود"><Select value={editProviderId} onChange={(event) => setEditProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.provider}</option>)}</Select></Field><Field label="النموذج"><Select name="model" defaultValue={editModels.includes(version.model) ? version.model : editModels[0]}>{editModels.map((model) => <option key={model}>{model}</option>)}</Select></Field></div></fieldset>
      <fieldset><legend>3. تعليمات النظام</legend><Field label="التعليمات"><Textarea name="instructions" defaultValue={version.instructions} required rows={10} maxLength={30000} /></Field></fieldset>
      <fieldset><legend>4. حدود التشغيل</legend><div className="agent-fields"><Field label="Temperature"><Input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={version.temperatureMilli / 1000} /></Field><Field label="حد الإخراج"><Input name="maxOutputTokens" type="number" min={64} max={32768} defaultValue={version.maxOutputTokens} /></Field></div></fieldset>
      <footer className="modal-actions"><Button variant="secondary" onClick={() => setDetails(null)}>إلغاء</Button><Button type="submit" disabled={busy !== null || !editModels.length}>حفظ كإصدار جديد</Button></footer>
    </form><section className="agent-version-panel"><h3><History size={16} /> سجل الإصدارات</h3><div>{details.versions.map((item, index) => <button type="button" key={item.id} onClick={() => { setSelectedVersion(index); setEditProviderId(item.providerCredentialId); }} className={index === selectedVersion ? "agent-version-active" : undefined}><span>الإصدار {item.version}</span><bdi dir="ltr">{item.model}</bdi><small>{new Date(item.createdAt).toLocaleString("ar")}</small></button>)}</div></section></section></div> : null}
  </div>;
}
