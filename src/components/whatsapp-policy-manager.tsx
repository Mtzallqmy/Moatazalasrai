"use client";

import { useMemo, useState } from "react";

type Option = { id: string; name: string };
type ProviderOption = Option & { provider: string; models: string[]; defaultModel: string | null };
type ToolOption = Option & { title: string | null; risk: string };
type MemberOption = Option & { email: string };

type Policy = {
  agentId: string | null;
  providerCredentialId: string | null;
  modelId: string | null;
  allowedTools: string[];
  permissions: string[];
  monthlyLimit: number | null;
  autoReplyEnabled: boolean;
  humanHandoffEnabled: boolean;
  memoryEnabled: boolean;
  filesEnabled: boolean;
  status: "active" | "disabled";
  forceHumanHandoff: boolean;
};

type ResponseData = {
  endpoint: {
    displayPhoneNumber: string;
    phoneNumberId: string;
    businessAccountId: string;
    credentialSource: string;
    status: string;
  } | null;
  effective: Policy;
};

const permissionOptions = [
  ["ai.chat", "الدردشة بالذكاء الاصطناعي"],
  ["agent.use", "استخدام الوكيل"],
  ["tools.execute", "تنفيذ الأدوات"],
  ["files.use", "استخدام الملفات"],
  ["search.use", "البحث"],
  ["workflows.execute", "تشغيل سير العمل"],
  ["handoff.request", "طلب موظف بشري"],
] as const;

function normalizePolicy(policy: Policy, providers: ProviderOption[]) {
  if (!policy.providerCredentialId) return policy;
  const provider = providers.find((item) => item.id === policy.providerCredentialId);
  if (!provider) return { ...policy, providerCredentialId: null, modelId: null };
  const modelId = policy.modelId && provider.models.includes(policy.modelId)
    ? policy.modelId
    : provider.defaultModel && provider.models.includes(provider.defaultModel)
      ? provider.defaultModel
      : provider.models[0] ?? null;
  return { ...policy, modelId };
}

export function WhatsAppPolicyManager(props: {
  canManage: boolean;
  role: string;
  initialData: ResponseData;
  options: {
    agents: Option[];
    providers: ProviderOption[];
    tools: ToolOption[];
    members: MemberOption[];
  };
}) {
  const [scope, setScope] = useState<"organization" | "user" | "platform">("organization");
  const [userId, setUserId] = useState("");
  const [data, setData] = useState<ResponseData>(props.initialData);
  const [form, setForm] = useState<Policy>(() => normalizePolicy(props.initialData.effective, props.options.providers));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedProvider = useMemo(
    () => props.options.providers.find((provider) => provider.id === form.providerCredentialId) ?? null,
    [form.providerCredentialId, props.options.providers],
  );
  const validationError = useMemo(() => {
    if (form.status === "disabled") return null;
    if (!data.endpoint) return "قناة WhatsApp المركزية غير مهيأة من متغيرات البيئة.";
    if (!form.agentId) return "يجب اختيار وكيل صالح قبل تفعيل الرد الآلي.";
    if (!form.providerCredentialId) return "يجب اختيار مزود متحقق قبل تفعيل الرد الآلي.";
    if (!selectedProvider) return "المزود المختار لم يعد متاحًا أو غير متحقق.";
    if (selectedProvider.models.length === 0) return "لم يكتشف المزود أي نماذج. أعد التحقق من المزود في صفحة المزودات أولًا.";
    if (!form.modelId || !selectedProvider.models.includes(form.modelId)) return "اختر نموذجًا صالحًا من قائمة المزود.";
    if (form.autoReplyEnabled && !form.permissions.includes("ai.chat")) return "الرد الآلي يتطلب صلاحية الدردشة بالذكاء الاصطناعي.";
    if (form.allowedTools.length > 0 && !form.permissions.includes("tools.execute")) return "الأدوات المحددة تتطلب صلاحية تنفيذ الأدوات.";
    return null;
  }, [data.endpoint, form, selectedProvider]);

  async function loadPolicy(nextScope: typeof scope, nextUserId: string) {
    setLoading(true);
    setMessage("");
    try {
      const suffix = nextScope === "user" && nextUserId ? `?userId=${encodeURIComponent(nextUserId)}` : "";
      const response = await fetch(`/api/dashboard/channels/whatsapp-policy${suffix}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "تعذر تحميل إعدادات WhatsApp.");
      const next = payload.data as ResponseData;
      setData(next);
      setForm(normalizePolicy(next.effective, props.options.providers));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل إعدادات WhatsApp.");
    } finally {
      setLoading(false);
    }
  }

  function changeScope(nextScope: typeof scope) {
    const nextUserId = nextScope === "user" ? userId : "";
    setScope(nextScope);
    if (nextScope !== "user") setUserId("");
    void loadPolicy(nextScope, nextUserId);
  }

  function changeUser(nextUserId: string) {
    setUserId(nextUserId);
    if (nextUserId) void loadPolicy("user", nextUserId);
  }

  function changeProvider(providerCredentialId: string) {
    const provider = props.options.providers.find((item) => item.id === providerCredentialId) ?? null;
    setForm({
      ...form,
      providerCredentialId: provider?.id ?? null,
      modelId: provider?.defaultModel && provider.models.includes(provider.defaultModel)
        ? provider.defaultModel
        : provider?.models[0] ?? null,
    });
  }

  async function save() {
    if (!props.canManage) return;
    if (scope === "user" && !userId) {
      setMessage("اختر مستخدمًا أولًا.");
      return;
    }
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/channels/whatsapp-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, ...(scope === "user" ? { userId } : {}), ...form }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "تعذر حفظ الإعدادات.");
      await loadPolicy(scope, userId);
      setMessage("تم حفظ سياسة WhatsApp وتطبيقها على الرسائل التالية مباشرة.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ الإعدادات.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface-card space-y-5 p-5" aria-labelledby="whatsapp-policy-title" aria-busy={loading}>
      <header className="space-y-1">
        <h2 id="whatsapp-policy-title" className="text-lg font-semibold">إعدادات WhatsApp المركزية</h2>
        <p className="text-sm text-muted">الرقم الرسمي يُحمّل من Environment ويستخدم Webhook واحدًا. الإعدادات التالية تغيّر التوجيه والسياسات فقط.</p>
        {data.endpoint ? <p className="text-sm">الرقم: <bdi dir="ltr">{data.endpoint.displayPhoneNumber}</bdi> · الحالة: {data.endpoint.status}</p> : <p className="text-sm text-danger">لم تُحمّل قناة WhatsApp من Environment بعد.</p>}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm"><span>مستوى السياسة</span><select className="input" value={scope} onChange={(event) => changeScope(event.target.value as typeof scope)} disabled={!props.canManage || loading}><option value="organization">المؤسسة</option><option value="user">مستخدم محدد</option>{props.role === "owner" ? <option value="platform">افتراضيات المنصة</option> : null}</select></label>
        {scope === "user" ? <label className="space-y-1 text-sm"><span>المستخدم</span><select className="input" value={userId} onChange={(event) => changeUser(event.target.value)} disabled={!props.canManage || loading}><option value="">اختر مستخدمًا</option>{props.options.members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}</select></label> : null}
        <label className="space-y-1 text-sm"><span>الحالة</span><select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Policy["status"] })} disabled={!props.canManage || loading}><option value="active">مفعل</option><option value="disabled">معطل</option></select></label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm"><span>الوكيل</span><select className="input" value={form.agentId ?? ""} onChange={(event) => setForm({ ...form, agentId: event.target.value || null })} disabled={!props.canManage || loading}><option value="">اختر الوكيل</option>{props.options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>المزود / مفتاح BYOK المحفوظ</span><select className="input" value={form.providerCredentialId ?? ""} onChange={(event) => changeProvider(event.target.value)} disabled={!props.canManage || loading}><option value="">اختر المزود</option>{props.options.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>النموذج</span><select className="input" value={form.modelId ?? ""} onChange={(event) => setForm({ ...form, modelId: event.target.value })} disabled={!props.canManage || loading || !selectedProvider || selectedProvider.models.length === 0}><option value="" disabled>{selectedProvider ? "اختر النموذج" : "اختر المزود أولًا"}</option>{selectedProvider?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select>{selectedProvider && selectedProvider.models.length === 0 ? <small className="text-danger">لا توجد نماذج مكتشفة لهذا المزود.</small> : null}</label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <fieldset className="space-y-2" disabled={!props.canManage || loading}><legend className="text-sm font-medium">الصلاحيات</legend>{permissionOptions.map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.permissions.includes(value)} onChange={(event) => setForm({ ...form, permissions: event.target.checked ? [...form.permissions, value] : form.permissions.filter((item) => item !== value), ...(value === "tools.execute" && !event.target.checked ? { allowedTools: [] } : {}) })} /><span>{label}</span></label>)}<p className="text-xs text-muted">العمليات المالية والحساسة محظورة من WhatsApp وتتطلب إعادة مصادقة داخل الموقع.</p></fieldset>
        <fieldset className="space-y-2" disabled={!props.canManage || loading}><legend className="text-sm font-medium">الأدوات المسموحة</legend><div className="max-h-56 space-y-2 overflow-auto">{props.options.tools.map((tool) => <label key={tool.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.allowedTools.includes(tool.id)} disabled={!form.permissions.includes("tools.execute")} onChange={(event) => setForm({ ...form, allowedTools: event.target.checked ? [...form.allowedTools, tool.id] : form.allowedTools.filter((item) => item !== tool.id) })} /><span>{tool.title || tool.name} <small className="text-muted">({tool.risk})</small></span></label>)}</div></fieldset>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm"><span>الحد الشهري</span><input className="input" type="number" min={1} value={form.monthlyLimit ?? ""} onChange={(event) => setForm({ ...form, monthlyLimit: event.target.value ? Number(event.target.value) : null })} disabled={!props.canManage || loading} /></label>
        {[["autoReplyEnabled", "الرد الآلي"], ["humanHandoffEnabled", "التحويل البشري"], ["memoryEnabled", "الذاكرة"], ["filesEnabled", "الملفات"], ["forceHumanHandoff", "إجبار التحويل لموظف"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={Boolean(form[key as keyof Policy])} disabled={!props.canManage || loading} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} /><span>{label}</span></label>)}
      </div>

      {validationError ? <p className="text-sm text-danger" role="alert">{validationError}</p> : null}
      {message ? <p className="text-sm" role="status">{message}</p> : null}
      <button type="button" className="button-primary" onClick={() => void save()} disabled={!props.canManage || saving || loading || Boolean(validationError)}>{saving ? "جارٍ الحفظ…" : loading ? "جارٍ التحميل…" : "حفظ سياسة WhatsApp"}</button>
    </section>
  );
}
