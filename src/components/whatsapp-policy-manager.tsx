"use client";

import { useState } from "react";

type AgentOption = { id: string; name: string };
type ProviderOption = { id: string; name: string; provider: string; enabled: boolean; defaultModel: string | null; models: string[] };
type ToolOption = { id: string; name: string; title: string | null; risk: string };
type MemberOption = { id: string; name: string; email: string };
type InitialData = {
  endpoint: {
    displayPhoneNumber: string | null;
    phoneNumberId: string;
    businessAccountId: string;
    credentialSource: string;
    status: string;
  } | null;
  effective: Record<string, unknown> | null;
};

type FormState = {
  agentId: string | null;
  providerCredentialId: string | null;
  modelId: string | null;
  teamId: string | null;
  inboxId: string | null;
  workflowId: string | null;
  allowedTools: string[];
  allowedActions: string[];
  permissions: string[];
  monthlyLimit: number | null;
  autoReplyEnabled: boolean | null;
  humanHandoffEnabled: boolean | null;
  memoryEnabled: boolean | null;
  filesEnabled: boolean | null;
  status: "active" | "disabled";
  forceHumanHandoff: boolean;
};

const emptyForm: FormState = {
  agentId: null,
  providerCredentialId: null,
  modelId: null,
  teamId: null,
  inboxId: null,
  workflowId: null,
  allowedTools: [],
  allowedActions: [],
  permissions: ["ai.chat", "agent.use", "conversation.open"],
  monthlyLimit: null,
  autoReplyEnabled: null,
  humanHandoffEnabled: null,
  memoryEnabled: null,
  filesEnabled: null,
  status: "active",
  forceHumanHandoff: false,
};

export function WhatsAppPolicyManager(props: {
  canManage: boolean;
  initialData: InitialData;
  options: {
    agents: AgentOption[];
    providers: ProviderOption[];
    tools: ToolOption[];
    members: MemberOption[];
  };
}) {
  const [scope, setScope] = useState<"organization" | "user">("organization");
  const [userId, setUserId] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [data, setData] = useState<InitialData>(props.initialData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedProvider = props.options.providers.find((provider) => provider.id === form.providerCredentialId) ?? null;

  function normalizePolicy(policy: Record<string, unknown> | null | undefined): FormState {
    if (!policy) return emptyForm;
    return {
      agentId: typeof policy.agentId === "string" ? policy.agentId : null,
      providerCredentialId: typeof policy.providerCredentialId === "string" ? policy.providerCredentialId : null,
      modelId: typeof policy.modelId === "string" ? policy.modelId : null,
      teamId: typeof policy.teamId === "string" ? policy.teamId : null,
      inboxId: typeof policy.inboxId === "string" ? policy.inboxId : null,
      workflowId: typeof policy.workflowId === "string" ? policy.workflowId : null,
      allowedTools: Array.isArray(policy.allowedTools) ? policy.allowedTools.filter((value): value is string => typeof value === "string") : [],
      allowedActions: Array.isArray(policy.allowedActions) ? policy.allowedActions.filter((value): value is string => typeof value === "string") : [],
      permissions: Array.isArray(policy.permissions) ? policy.permissions.filter((value): value is string => typeof value === "string") : [],
      monthlyLimit: typeof policy.monthlyLimit === "number" ? policy.monthlyLimit : null,
      autoReplyEnabled: typeof policy.autoReplyEnabled === "boolean" ? policy.autoReplyEnabled : null,
      humanHandoffEnabled: typeof policy.humanHandoffEnabled === "boolean" ? policy.humanHandoffEnabled : null,
      memoryEnabled: typeof policy.memoryEnabled === "boolean" ? policy.memoryEnabled : null,
      filesEnabled: typeof policy.filesEnabled === "boolean" ? policy.filesEnabled : null,
      status: policy.status === "disabled" ? "disabled" : "active",
      forceHumanHandoff: policy.forceHumanHandoff === true,
    };
  }

  async function loadPolicy(nextScope: typeof scope, nextUserId: string) {
    setLoading(true);
    setMessage(null);
    try {
      const query = nextScope === "user" && nextUserId ? `?userId=${encodeURIComponent(nextUserId)}` : "";
      const response = await fetch(`/api/dashboard/channels/whatsapp-policy${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "تعذر تحميل سياسة واتساب.");
      const source = nextScope === "user" ? payload.data.userPolicy : payload.data.organizationPolicy;
      setForm(normalizePolicy(source));
      setData({ endpoint: payload.data.endpoint, effective: payload.data.effective });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل سياسة واتساب.");
    } finally {
      setLoading(false);
    }
  }

  function changeScope(nextScope: typeof scope) {
    setScope(nextScope);
    if (nextScope !== "user") setUserId("");
    void loadPolicy(nextScope, nextScope === "user" ? userId : "");
  }

  function changeUser(nextUserId: string) {
    setUserId(nextUserId);
    if (scope === "user" && nextUserId) void loadPolicy("user", nextUserId);
  }

  function toggleTool(toolId: string) {
    setForm((current) => ({
      ...current,
      allowedTools: current.allowedTools.includes(toolId)
        ? current.allowedTools.filter((id) => id !== toolId)
        : [...current.allowedTools, toolId],
    }));
  }

  function updateBoolean(key: keyof Pick<FormState, "autoReplyEnabled" | "humanHandoffEnabled" | "memoryEnabled" | "filesEnabled">, value: string) {
    setForm((current) => ({ ...current, [key]: value === "inherit" ? null : value === "true" }));
  }

  async function save() {
    if (!props.canManage) return;
    if (scope === "user" && !userId) {
      setMessage("اختر مستخدمًا قبل حفظ سياسة المستخدم.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/channels/whatsapp-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, ...(scope === "user" ? { userId } : {}), ...form }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "تعذر حفظ سياسة واتساب.");
      setMessage("تم حفظ سياسة واتساب.");
      await loadPolicy(scope, userId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ سياسة واتساب.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">WhatsApp Policy</p>
          <h2 className="mt-2 text-xl font-black">سياسة قناة واتساب المركزية</h2>
          <p className="mt-2 text-sm leading-7 text-stone-400">السياسات هنا خاصة بالمؤسسة أو المستخدم فقط. افتراضيات المنصة العالمية لا يمكن تعديلها من Tenant Plane.</p>
        </div>
        <span className={`status-pill ${data.endpoint?.status === "active" ? "status-pill-success" : "status-pill-warning"}`}>
          {data.endpoint?.status === "active" ? "القناة المركزية فعالة" : "القناة المركزية غير جاهزة"}
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm"><span>مستوى السياسة</span><select className="input" value={scope} onChange={(event) => changeScope(event.target.value as typeof scope)} disabled={!props.canManage || loading}><option value="organization">المؤسسة</option><option value="user">مستخدم محدد</option></select></label>
        {scope === "user" ? <label className="space-y-1 text-sm"><span>المستخدم</span><select className="input" value={userId} onChange={(event) => changeUser(event.target.value)} disabled={!props.canManage || loading}><option value="">اختر مستخدمًا</option>{props.options.members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}</select></label> : null}
        <label className="space-y-1 text-sm"><span>الوكيل</span><select className="input" value={form.agentId ?? ""} onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value || null }))} disabled={!props.canManage || loading}><option value="">موروث / افتراضي</option>{props.options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>المزود</span><select className="input" value={form.providerCredentialId ?? ""} onChange={(event) => setForm((current) => ({ ...current, providerCredentialId: event.target.value || null, modelId: null }))} disabled={!props.canManage || loading}><option value="">موروث / افتراضي</option>{props.options.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>النموذج</span><select className="input" value={form.modelId ?? ""} onChange={(event) => setForm((current) => ({ ...current, modelId: event.target.value || null }))} disabled={!props.canManage || loading || !selectedProvider}><option value="">موروث / افتراضي</option>{selectedProvider?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>الحد الشهري</span><input className="input" type="number" min={1} max={100000000} value={form.monthlyLimit ?? ""} onChange={(event) => setForm((current) => ({ ...current, monthlyLimit: event.target.value ? Number(event.target.value) : null }))} disabled={!props.canManage || loading} /></label>
        <label className="space-y-1 text-sm"><span>الحالة</span><select className="input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value === "disabled" ? "disabled" : "active" }))} disabled={!props.canManage || loading}><option value="active">نشطة</option><option value="disabled">معطلة</option></select></label>
        <label className="space-y-1 text-sm"><span>الرد التلقائي</span><select className="input" value={form.autoReplyEnabled === null ? "inherit" : String(form.autoReplyEnabled)} onChange={(event) => updateBoolean("autoReplyEnabled", event.target.value)} disabled={!props.canManage || loading}><option value="inherit">موروث</option><option value="true">مفعل</option><option value="false">معطل</option></select></label>
        <label className="space-y-1 text-sm"><span>التحويل البشري</span><select className="input" value={form.humanHandoffEnabled === null ? "inherit" : String(form.humanHandoffEnabled)} onChange={(event) => updateBoolean("humanHandoffEnabled", event.target.value)} disabled={!props.canManage || loading}><option value="inherit">موروث</option><option value="true">مفعل</option><option value="false">معطل</option></select></label>
        <label className="space-y-1 text-sm"><span>الذاكرة</span><select className="input" value={form.memoryEnabled === null ? "inherit" : String(form.memoryEnabled)} onChange={(event) => updateBoolean("memoryEnabled", event.target.value)} disabled={!props.canManage || loading}><option value="inherit">موروث</option><option value="true">مفعل</option><option value="false">معطل</option></select></label>
        <label className="space-y-1 text-sm"><span>الملفات</span><select className="input" value={form.filesEnabled === null ? "inherit" : String(form.filesEnabled)} onChange={(event) => updateBoolean("filesEnabled", event.target.value)} disabled={!props.canManage || loading}><option value="inherit">موروث</option><option value="true">مفعل</option><option value="false">معطل</option></select></label>
      </div>

      <div className="mt-5">
        <p className="text-sm font-bold">الأدوات المسموح بها</p>
        <div className="mt-2 flex flex-wrap gap-2">{props.options.tools.map((tool) => <label key={tool.id} className="chip"><input type="checkbox" checked={form.allowedTools.includes(tool.id)} onChange={() => toggleTool(tool.id)} disabled={!props.canManage || loading} /> <span>{tool.title || tool.name}</span></label>)}</div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button className="button-primary" type="button" onClick={save} disabled={!props.canManage || loading}>{loading ? "جارٍ الحفظ…" : "حفظ السياسة"}</button>
        {message ? <p className="text-sm text-stone-300">{message}</p> : null}
      </div>
    </section>
  );
}
