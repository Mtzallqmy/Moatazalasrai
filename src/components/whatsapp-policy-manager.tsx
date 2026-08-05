"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Option = { id: string; name: string };
type ProviderOption = Option & { models: string[] };
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

export function WhatsAppPolicyManager(props: {
  canManage: boolean;
  role: string;
  options: {
    agents: Option[];
    providers: ProviderOption[];
    tools: ToolOption[];
    members: MemberOption[];
  };
}) {
  const [scope, setScope] = useState<"organization" | "user" | "platform">("organization");
  const [userId, setUserId] = useState("");
  const [data, setData] = useState<ResponseData | null>(null);
  const [form, setForm] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedProvider = useMemo(
    () => props.options.providers.find((provider) => provider.id === form?.providerCredentialId) ?? null,
    [form?.providerCredentialId, props.options.providers],
  );

  const load = useCallback(async () => {
    try {
      const suffix = scope === "user" && userId ? `?userId=${encodeURIComponent(userId)}` : "";
      const response = await fetch(`/api/dashboard/channels/whatsapp-policy${suffix}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "تعذر تحميل إعدادات WhatsApp.");
      const next = payload.data as ResponseData;
      setData(next);
      setForm(next.effective);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل إعدادات WhatsApp.");
    } finally {
      setLoading(false);
    }
  }, [scope, userId]);

  useEffect(() => { void load(); }, [load]);

  function changeScope(nextScope: typeof scope) {
    setLoading(true);
    setMessage("");
    setScope(nextScope);
  }

  function changeUser(nextUserId: string) {
    setLoading(true);
    setMessage("");
    setUserId(nextUserId);
  }

  async function save() {
    if (!form || !props.canManage) return;
    if (scope === "user" && !userId) {
      setMessage("اختر مستخدمًا أولًا.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/channels/whatsapp-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope,
          ...(scope === "user" ? { userId } : {}),
          agentId: form.agentId,
          providerCredentialId: form.providerCredentialId,
          modelId: form.modelId,
          allowedTools: form.allowedTools,
          permissions: form.permissions,
          monthlyLimit: form.monthlyLimit,
          autoReplyEnabled: form.autoReplyEnabled,
          humanHandoffEnabled: form.humanHandoffEnabled,
          memoryEnabled: form.memoryEnabled,
          filesEnabled: form.filesEnabled,
          status: form.status,
          forceHumanHandoff: form.forceHumanHandoff,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "تعذر حفظ الإعدادات.");
      setMessage("تم حفظ سياسة WhatsApp وتطبيقها على الرسائل التالية مباشرة.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ الإعدادات.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) {
    return <section className="surface-card p-5"><p className="text-sm text-muted">جارٍ تحميل إعدادات WhatsApp المركزية…</p></section>;
  }

  return (
    <section className="surface-card space-y-5 p-5" aria-labelledby="whatsapp-policy-title">
      <header className="space-y-1">
        <h2 id="whatsapp-policy-title" className="text-lg font-semibold">إعدادات WhatsApp المركزية</h2>
        <p className="text-sm text-muted">
          الرقم الرسمي يُحمّل من Environment ويستخدم Webhook واحدًا. هذه الإعدادات تغيّر التوجيه والسياسات فقط ولا تنشئ اتصالًا أو Webhook جديدًا.
        </p>
        {data?.endpoint ? (
          <p className="text-sm">الرقم: <bdi dir="ltr">{data.endpoint.displayPhoneNumber}</bdi> · الحالة: {data.endpoint.status} · المصدر: {data.endpoint.credentialSource}</p>
        ) : <p className="text-sm text-danger">لم تُحمّل قناة WhatsApp من Environment بعد.</p>}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span>مستوى السياسة</span>
          <select className="input" value={scope} onChange={(event) => changeScope(event.target.value as typeof scope)} disabled={!props.canManage}>
            <option value="organization">المؤسسة</option>
            <option value="user">مستخدم محدد</option>
            {props.role === "owner" ? <option value="platform">افتراضيات المنصة</option> : null}
          </select>
        </label>
        {scope === "user" ? (
          <label className="space-y-1 text-sm">
            <span>المستخدم</span>
            <select className="input" value={userId} onChange={(event) => changeUser(event.target.value)} disabled={!props.canManage}>
              <option value="">اختر مستخدمًا</option>
              {props.options.members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}
            </select>
          </label>
        ) : null}
        <label className="space-y-1 text-sm">
          <span>الحالة</span>
          <select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Policy["status"] })} disabled={!props.canManage}>
            <option value="active">مفعل</option>
            <option value="disabled">معطل</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span>الوكيل</span>
          <select className="input" value={form.agentId ?? ""} onChange={(event) => setForm({ ...form, agentId: event.target.value || null })} disabled={!props.canManage}>
            <option value="">استخدام المستوى الأعلى</option>
            {props.options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>المزود / مفتاح BYOK المحفوظ</span>
          <select className="input" value={form.providerCredentialId ?? ""} onChange={(event) => setForm({ ...form, providerCredentialId: event.target.value || null, modelId: null })} disabled={!props.canManage}>
            <option value="">استخدام المستوى الأعلى</option>
            {props.options.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>النموذج</span>
          <select className="input" value={form.modelId ?? ""} onChange={(event) => setForm({ ...form, modelId: event.target.value || null })} disabled={!props.canManage || !selectedProvider}>
            <option value="">استخدام الافتراضي</option>
            {selectedProvider?.models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">الصلاحيات</legend>
          {permissionOptions.map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.permissions.includes(value)} disabled={!props.canManage}
                onChange={(event) => setForm({ ...form, permissions: event.target.checked ? [...form.permissions, value] : form.permissions.filter((item) => item !== value) })} />
              <span>{label}</span>
            </label>
          ))}
          <p className="text-xs text-muted">العمليات المالية والحساسة محظورة دائمًا من واتساب، وتحتاج موافقة وإعادة مصادقة داخل الموقع.</p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">الأدوات المسموحة</legend>
          <div className="max-h-56 space-y-2 overflow-auto">
            {props.options.tools.map((tool) => (
              <label key={tool.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={form.allowedTools.includes(tool.id)} disabled={!props.canManage || !form.permissions.includes("tools.execute")}
                  onChange={(event) => setForm({ ...form, allowedTools: event.target.checked ? [...form.allowedTools, tool.id] : form.allowedTools.filter((item) => item !== tool.id) })} />
                <span>{tool.title || tool.name} <small className="text-muted">({tool.risk})</small></span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span>الحد الشهري</span>
          <input className="input" type="number" min={1} value={form.monthlyLimit ?? ""}
            onChange={(event) => setForm({ ...form, monthlyLimit: event.target.value ? Number(event.target.value) : null })} disabled={!props.canManage} />
        </label>
        {[
          ["autoReplyEnabled", "الرد الآلي"],
          ["humanHandoffEnabled", "التحويل البشري"],
          ["memoryEnabled", "الذاكرة"],
          ["filesEnabled", "الملفات"],
          ["forceHumanHandoff", "إجبار التحويل لموظف"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={Boolean(form[key as keyof Policy])} disabled={!props.canManage}
              onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {message ? <p className="text-sm" role="status">{message}</p> : null}
      <button type="button" className="button-primary" onClick={() => void save()} disabled={!props.canManage || saving}>
        {saving ? "جارٍ الحفظ…" : "حفظ سياسة WhatsApp"}
      </button>
    </section>
  );
}
