"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getProviderPreset, providerPresets } from "@/lib/providers/catalog";

export type ProviderSummary = {
  id: string;
  provider: "openai" | "anthropic" | "gemini" | "openai_compatible";
  providerTypeId: "cloudflare-workers-ai" | "cloudflare-ai-gateway" | "openai" | "anthropic" | "google-ai-studio" | "custom-openai-compatible";
  transportMode: "direct" | "cloudflare_ai_gateway_native" | "cloudflare_ai_gateway_rest" | "cloudflare_workers_ai";
  credentialMode: "encrypted_byok" | "cloudflare_provider_key" | "cloudflare_binding";
  providerSlug: string;
  providerLabel: string;
  apiStyle: string;
  name: string;
  baseUrl: string;
  gatewayId: string | null;
  keyAlias: string | null;
  gatewaySkipCache: boolean;
  gatewayCacheTtl: number | null;
  gatewayCollectLog: boolean;
  defaultModel: string | null;
  allowedModels: string[];
  capabilities: Record<string, boolean>;
  secretHint: string | null;
  discoveredModels: string[];
  validationStatus: "pending" | "verified" | "failed";
  healthStatus: "unconfigured" | "validating" | "healthy" | "degraded" | "rate_limited" | "unauthorized" | "model_unavailable" | "network_error" | "misconfigured" | "disabled" | "unknown";
  lastValidatedAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulAt: string | null;
  lastFailureAt: string | null;
  lastValidationLatencyMs: number | null;
  lastErrorCode: string | null;
  lastErrorCategory: string | null;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type Action = "toggle" | "revalidate" | "edit" | "default" | "delete";
type ErrorPayload = { message?: string; requestId?: string; action?: { ar?: string }; details?: Array<{ message?: string }> };

const healthLabels: Record<ProviderSummary["healthStatus"], string> = {
  unconfigured: "غير مهيأ",
  validating: "جارٍ الفحص",
  healthy: "سليم",
  degraded: "متدهور",
  rate_limited: "محدود مؤقتًا",
  unauthorized: "مصادقة مرفوضة",
  model_unavailable: "النموذج غير متاح",
  network_error: "خطأ شبكة",
  misconfigured: "إعداد غير صالح",
  disabled: "معطل",
  unknown: "غير معروف",
};

function errorText(error: ErrorPayload | undefined, fallback: string) {
  return [
    error?.message?.trim() || fallback,
    error?.details?.map((item) => item.message).filter(Boolean).join("، "),
    error?.action?.ar?.trim(),
    error?.requestId ? `معرّف الطلب: ${error.requestId}` : null,
  ].filter(Boolean).join(" ");
}

function dateText(value: string | null) {
  return value ? new Date(value).toLocaleString("ar") : "غير متاح";
}

function revalidationPayload(provider: ProviderSummary) {
  return {
    id: provider.id,
    providerTypeId: provider.providerTypeId,
    providerSlug: provider.providerSlug,
    transportMode: provider.transportMode,
    credentialMode: provider.credentialMode,
    gatewayId: provider.gatewayId,
    keyAlias: provider.keyAlias,
    defaultModel: provider.defaultModel,
    allowedModels: provider.allowedModels,
    skipCache: provider.gatewaySkipCache,
    cacheTtl: provider.gatewayCacheTtl,
    collectLog: provider.gatewayCollectLog,
    revalidate: true,
    testModel: provider.defaultModel ?? provider.discoveredModels[0],
  };
}

export function ProviderManager({ initialProviders }: { initialProviders: ProviderSummary[] }) {
  const router = useRouter();
  const [providers, setProviders] = useState(initialProviders);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [editing, setEditing] = useState<ProviderSummary | null>(null);
  const [editSlug, setEditSlug] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [deleting, setDeleting] = useState<ProviderSummary | null>(null);

  const filteredModelCount = useMemo(() => providers.reduce((sum, provider) => (
    sum + provider.discoveredModels.filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase())).length
  ), 0), [modelSearch, providers]);

  async function mutate(id: string, action: Action, body: Record<string, unknown>, method = "PATCH") {
    setBusy({ id, action });
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/providers", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: ProviderSummary | { deleted: true; id: string };
        error?: ErrorPayload;
      } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        setMessage(errorText(payload?.error, "تعذر إكمال الإجراء."));
        return false;
      }
      if (method === "DELETE") {
        setProviders((items) => items.filter((item) => item.id !== id));
      } else {
        const updated = payload.data as ProviderSummary;
        setProviders((items) => items.map((item) => item.id === id ? updated : {
          ...item,
          isDefault: updated.isDefault ? false : item.isDefault,
        }));
      }
      router.refresh();
      return true;
    } catch {
      setMessage("تعذر الوصول إلى الخادم. لا يمكن تأكيد نتيجة الإجراء.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function openEdit(provider: ProviderSummary) {
    setEditing(provider);
    setEditSlug(provider.providerSlug);
    setEditBaseUrl(provider.baseUrl);
    setMessage(null);
  }

  function changeEditPreset(slug: string) {
    const preset = getProviderPreset(slug);
    if (!preset || !editing || preset.provider !== editing.provider) return;
    setEditSlug(slug);
    if (preset.defaultBaseUrl) setEditBaseUrl(preset.defaultBaseUrl);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const body: Record<string, unknown> = { id: editing.id };
    if (name !== editing.name) body.name = name;

    if (editing.transportMode === "direct") {
      const apiKey = String(form.get("apiKey") ?? "").trim();
      const testModel = String(form.get("testModel") ?? "").trim();
      const manualModel = String(form.get("manualModel") ?? "").trim();
      const normalizedBase = editBaseUrl.trim().replace(/\/+$/, "");
      const currentBase = editing.baseUrl.replace(/\/+$/, "");
      const connectionChanged = Boolean(apiKey || manualModel || editSlug !== editing.providerSlug || normalizedBase !== currentBase);
      if (connectionChanged) {
        Object.assign(body, {
          providerTypeId: editing.providerTypeId,
          transportMode: editing.transportMode,
          credentialMode: editing.credentialMode,
          providerSlug: editSlug,
          baseUrl: editBaseUrl,
          revalidate: true,
          testModel: testModel || manualModel || editing.defaultModel || editing.discoveredModels[0],
        });
        if (apiKey) body.apiKey = apiKey;
        if (manualModel) body.manualModel = manualModel;
      }
    }

    if (Object.keys(body).length === 1) {
      setEditing(null);
      setMessage("لم تتغير بيانات الاتصال.");
      return;
    }
    const ok = await mutate(editing.id, "edit", body);
    if (ok) {
      setEditing(null);
      setMessage("تم حفظ التعديل. أي تغيير في الاتصال لا يعتمد إلا بعد اختبار فعلي ناجح.");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const ok = await mutate(deleting.id, "delete", { id: deleting.id }, "DELETE");
    if (ok) {
      setDeleting(null);
      setMessage("تم الحذف الناعم مع الإبقاء على سجلات التشغيل والتشخيص التاريخية.");
    }
  }

  return <section className="soft-card mt-5 p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold">الاتصالات المحفوظة</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">الحالة مبنية على آخر دليل فعلي؛ الحالة غير المعروفة لا تُعرض كسليمة.</p>
      </div>
      <label className="grid gap-1 text-xs text-[var(--text-secondary)]">البحث في النماذج
        <input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} className="form-control py-2 text-sm" placeholder="اسم النموذج" />
      </label>
    </div>
    {message ? <p className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm" role="status">{message}</p> : null}
    {providers.length === 0 ? <p className="mt-5 rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--text-secondary)]">لم تتم إضافة مزود بعد.</p> : <>
      <p className="mt-4 text-xs text-[var(--text-secondary)]">النتائج المطابقة: {filteredModelCount} نموذج</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {providers.map((provider) => {
          const models = provider.discoveredModels.filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase()));
          const isBusy = busy?.id === provider.id;
          const healthy = provider.enabled && provider.healthStatus === "healthy" && provider.validationStatus === "verified" && !provider.circuitOpenUntil;
          return <article key={provider.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-latin text-xs uppercase tracking-wider text-[var(--primary)]" dir="ltr">{provider.providerTypeId} · {provider.transportMode}</p>
                <h3 className="mt-1 font-bold">{provider.name}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{provider.providerLabel}{provider.isDefault ? " — افتراضي" : ""}</p>
              </div>
              <span className={`status-badge ${healthy ? "status-success" : "status-error"}`}>{healthLabels[provider.healthStatus]}</span>
            </div>
            <div className="mt-4 grid gap-1 text-xs text-[var(--text-secondary)]">
              <p className="break-all font-mono" dir="ltr">{provider.baseUrl}</p>
              {provider.gatewayId ? <p dir="ltr">Gateway: {provider.gatewayId}</p> : null}
              <p dir="ltr">Credential: {provider.secretHint ?? provider.credentialMode}</p>
              {provider.defaultModel ? <p dir="ltr">Default model: {provider.defaultModel}</p> : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button disabled={isBusy} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => void mutate(provider.id, "toggle", { id: provider.id, enabled: !provider.enabled })} type="button">
                {busy?.id === provider.id && busy.action === "toggle" ? "جارٍ التحديث..." : provider.enabled ? "تعطيل" : "تفعيل"}
              </button>
              <button disabled={isBusy || !provider.defaultModel && provider.discoveredModels.length === 0} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => void mutate(provider.id, "revalidate", revalidationPayload(provider))} type="button">
                {busy?.id === provider.id && busy.action === "revalidate" ? "جارٍ الفحص..." : "إعادة فحص فعلية"}
              </button>
              {!provider.isDefault && provider.validationStatus === "verified" ? <button disabled={isBusy} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => void mutate(provider.id, "default", { id: provider.id, isDefault: true })} type="button">جعله افتراضيًا</button> : null}
              <button disabled={isBusy} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => openEdit(provider)} type="button">تعديل</button>
              <button disabled={isBusy} className="danger-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => setDeleting(provider)} type="button">حذف</button>
            </div>
            <details className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="cursor-pointer text-sm font-semibold">النماذج ({models.length})</summary>
              <div className="mt-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto" dir="ltr">
                {models.map((model) => <span key={model} className="rounded-full border border-[var(--border)] px-2.5 py-1 font-mono text-xs">{model}</span>)}
                {models.length === 0 ? <span className="text-xs text-[var(--text-secondary)]">لا توجد نتائج مطابقة.</span> : null}
              </div>
            </details>
            <div className="mt-3 grid gap-1 text-xs text-[var(--text-secondary)]">
              <p>آخر فحص: {dateText(provider.lastCheckedAt ?? provider.lastValidatedAt)}{provider.lastValidationLatencyMs === null ? "" : ` — ${provider.lastValidationLatencyMs}ms`}</p>
              {provider.lastSuccessfulAt ? <p>آخر نجاح مؤكد: {dateText(provider.lastSuccessfulAt)}</p> : null}
              {provider.lastFailureAt ? <p>آخر فشل: {dateText(provider.lastFailureAt)}</p> : null}
              {provider.lastErrorCode ? <p dir="ltr">{provider.lastErrorCategory ?? "unknown"} · {provider.lastErrorCode}</p> : null}
              {provider.circuitOpenUntil ? <p>الدائرة متوقفة حتى: {dateText(provider.circuitOpenUntil)}</p> : null}
            </div>
          </article>;
        })}
      </div>
    </>}

    {editing ? <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-provider-title">
        <h2 id="edit-provider-title" className="text-xl font-bold">تعديل {editing.name}</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">لا تُعرض قيمة السر الحالية. التعديل على مسار Cloudflare يقتصر هنا على الاسم؛ أضف اتصالًا جديدًا لتغيير مرجع السر أو نوع النقل بصورة قابلة للتدقيق.</p>
        <form onSubmit={saveEdit} className="mt-5 grid gap-4">
          <label className="grid gap-2 text-sm">الاسم<input name="name" defaultValue={editing.name} required maxLength={80} className="form-control" /></label>
          {editing.transportMode === "direct" ? <>
            <label className="grid gap-2 text-sm">إعداد المزود<select value={editSlug} onChange={(event) => changeEditPreset(event.target.value)} className="form-control">
              {providerPresets.filter((preset) => preset.provider === editing.provider).map((preset) => <option key={preset.slug} value={preset.slug}>{preset.labelAr}</option>)}
            </select></label>
            <label className="grid gap-2 text-sm">Base URL<input value={editBaseUrl} onChange={(event) => setEditBaseUrl(event.target.value)} type="url" dir="ltr" required readOnly={!getProviderPreset(editSlug)?.baseUrlEditable} className="form-control font-mono read-only:opacity-75" /></label>
            <label className="grid gap-2 text-sm">مفتاح جديد — اختياري<input name="apiKey" type="password" minLength={8} maxLength={4000} autoComplete="off" className="form-control font-mono" /></label>
            <label className="grid gap-2 text-sm">نموذج يدوي — اختياري<input name="manualModel" maxLength={300} dir="ltr" className="form-control font-mono" /></label>
            <label className="grid gap-2 text-sm">نموذج الاختبار<select name="testModel" dir="ltr" className="form-control font-mono" defaultValue={editing.defaultModel ?? editing.discoveredModels[0]}>{editing.discoveredModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
          </> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="secondary-button" onClick={() => setEditing(null)}>إلغاء</button>
            <button disabled={busy !== null} className="primary-button" type="submit">{busy ? "جارٍ الحفظ..." : "حفظ"}</button>
          </div>
        </form>
      </section>
    </div> : null}

    {deleting ? <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-provider-title">
        <h2 id="delete-provider-title" className="text-xl font-bold">حذف {deleting.name}</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">سيُزال الاتصال من الاستخدام، مع إبقاء سجلات التشغيل والتشخيص اللازمة للتدقيق.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="secondary-button" onClick={() => setDeleting(null)} type="button">إلغاء</button>
          <button disabled={busy !== null} className="danger-button" onClick={() => void confirmDelete()} type="button">{busy ? "جارٍ الحذف..." : "حذف الاتصال"}</button>
        </div>
      </section>
    </div> : null}
  </section>;
}
