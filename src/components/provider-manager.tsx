"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getProviderPreset, providerPresets } from "@/lib/providers/catalog";

export type ProviderSummary = {
  id: string;
  provider: "openai" | "anthropic" | "gemini" | "openai_compatible";
  providerSlug: string;
  providerLabel: string;
  apiStyle: string;
  name: string;
  baseUrl: string;
  secretHint: string;
  discoveredModels: string[];
  validationStatus: "pending" | "verified" | "failed";
  lastValidatedAt: string | null;
  lastValidationLatencyMs: number | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type Action = "toggle" | "revalidate" | "edit" | "delete";
type ErrorPayload = { message?: string; action?: { ar?: string }; details?: Array<{ message?: string }> };

function errorText(error: ErrorPayload | undefined, fallback: string) {
  return [
    error?.message?.trim() || fallback,
    error?.details?.map((item) => item.message).filter(Boolean).join("، "),
    error?.action?.ar?.trim(),
  ].filter(Boolean).join(" ");
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
        setProviders((items) => items.map((item) => item.id === id ? updated : item));
      }
      router.refresh();
      return true;
    } catch {
      setMessage("تعذر الوصول إلى الخادم. حاول مجددًا.");
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
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const testModel = String(form.get("testModel") ?? "").trim();
    const manualModel = String(form.get("manualModel") ?? "").trim();
    const normalizedBase = editBaseUrl.trim().replace(/\/+$/, "");
    const currentBase = editing.baseUrl.replace(/\/+$/, "");
    const connectionChanged = Boolean(
      apiKey
      || manualModel
      || editSlug !== editing.providerSlug
      || normalizedBase !== currentBase,
    );
    const body: Record<string, unknown> = { id: editing.id };
    if (name !== editing.name) body.name = name;
    if (connectionChanged) {
      body.providerSlug = editSlug;
      body.baseUrl = editBaseUrl;
      body.revalidate = true;
      if (apiKey) body.apiKey = apiKey;
      if (manualModel) body.manualModel = manualModel;
      body.testModel = testModel || manualModel || editing.discoveredModels[0];
    }
    if (Object.keys(body).length === 1) {
      setEditing(null);
      setMessage("لم تتغير بيانات الاتصال.");
      return;
    }
    const ok = await mutate(editing.id, "edit", body);
    if (ok) {
      setEditing(null);
      setMessage(connectionChanged ? "تم اختبار التعديلات وحفظ الاتصال بأمان." : "تم تحديث اسم الاتصال.");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const ok = await mutate(deleting.id, "delete", { id: deleting.id }, "DELETE");
    if (ok) {
      setDeleting(null);
      setMessage("تم حذف الاتصال من الاستخدام مع الإبقاء على سجلات التشغيل التاريخية.");
    }
  }

  return (
    <section className="soft-card mt-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">الاتصالات المحفوظة</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">تفعيل وتعطيل، اختبار حقيقي، تعديل آمن، حذف منطقي، والبحث في النماذج.</p>
        </div>
        <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
          البحث في النماذج
          <input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} className="form-control py-2 text-sm" placeholder="اسم النموذج" />
        </label>
      </div>
      {message ? <p className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm" role="status">{message}</p> : null}
      {providers.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--text-secondary)]">لم تتم إضافة مزود بعد.</p>
      ) : (
        <>
          <p className="mt-4 text-xs text-[var(--text-secondary)]">النتائج المطابقة: {filteredModelCount} نموذج</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {providers.map((provider) => {
              const models = provider.discoveredModels.filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase()));
              const isBusy = busy?.id === provider.id;
              const circuitOpen = Boolean(provider.circuitOpenUntil);
              const ready = provider.enabled && provider.validationStatus === "verified" && !circuitOpen;
              return (
                <article key={provider.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-latin text-xs uppercase tracking-wider text-[var(--primary)]" dir="ltr">{provider.providerSlug} · {provider.apiStyle}</p>
                      <h3 className="mt-1 font-bold">{provider.name}</h3>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">{provider.providerLabel}</p>
                    </div>
                    <span className={`status-badge ${ready ? "status-success" : "status-error"}`}>
                      {ready ? "جاهز" : circuitOpen ? "انتظار مؤقت" : provider.validationStatus === "failed" ? "يحتاج فحصًا" : "معطل"}
                    </span>
                  </div>
                  <p className="mt-4 break-all font-mono text-xs text-[var(--text-secondary)]" dir="ltr">{provider.baseUrl}</p>
                  <p className="mt-2 font-mono text-sm" dir="ltr">{provider.secretHint}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={isBusy} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => mutate(provider.id, "toggle", { id: provider.id, enabled: !provider.enabled })} type="button">
                      {busy?.id === provider.id && busy.action === "toggle" ? "جارٍ التحديث..." : provider.enabled ? "تعطيل" : "تفعيل"}
                    </button>
                    <button disabled={isBusy || provider.discoveredModels.length === 0} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => mutate(provider.id, "revalidate", {
                      id: provider.id,
                      providerSlug: provider.providerSlug,
                      revalidate: true,
                      testModel: provider.discoveredModels[0],
                    })} type="button">
                      {busy?.id === provider.id && busy.action === "revalidate" ? "جارٍ الفحص..." : "فحص المفتاح والنموذج"}
                    </button>
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
                  <p className="mt-3 text-xs text-[var(--text-secondary)]">
                    آخر فحص: {provider.lastValidatedAt ? new Date(provider.lastValidatedAt).toLocaleString("ar") : "غير متاح"}
                    {provider.lastValidationLatencyMs === null ? "" : ` — ${provider.lastValidationLatencyMs}ms`}
                    {provider.consecutiveFailures ? ` — إخفاقات: ${provider.consecutiveFailures}` : ""}
                    {provider.lastErrorCode ? ` — ${provider.lastErrorCode}` : ""}
                  </p>
                </article>
              );
            })}
          </div>
        </>
      )}

      {editing ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-provider-title">
            <h2 id="edit-provider-title" className="text-xl font-bold">تعديل {editing.name}</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">تعديل الاسم فقط لا يعيد الفحص. تغيير المنصة أو العنوان أو المفتاح يفرض اختبارًا حقيقيًا قبل الحفظ.</p>
            <form onSubmit={saveEdit} className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm">الاسم<input name="name" defaultValue={editing.name} required maxLength={80} className="form-control" /></label>
              <label className="grid gap-2 text-sm">
                إعداد المزود
                <select value={editSlug} onChange={(event) => changeEditPreset(event.target.value)} className="form-control">
                  {providerPresets.filter((preset) => preset.provider === editing.provider).map((preset) => <option key={preset.slug} value={preset.slug}>{preset.labelAr}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm">Base URL<input value={editBaseUrl} onChange={(event) => setEditBaseUrl(event.target.value)} type="url" dir="ltr" required readOnly={!getProviderPreset(editSlug)?.baseUrlEditable} className="form-control font-mono read-only:opacity-75" /></label>
              <label className="grid gap-2 text-sm">مفتاح جديد — اختياري<input name="apiKey" type="password" minLength={8} maxLength={4000} autoComplete="off" className="form-control font-mono" /></label>
              <label className="grid gap-2 text-sm">نموذج يدوي — اختياري<input name="manualModel" maxLength={300} dir="ltr" className="form-control font-mono" placeholder="provider/model-name" /></label>
              <label className="grid gap-2 text-sm">
                نموذج الاختبار
                <select name="testModel" dir="ltr" className="form-control font-mono" defaultValue={editing.discoveredModels[0]}>
                  {editing.discoveredModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>إلغاء</button>
                <button disabled={busy !== null} className="primary-button" type="submit">{busy ? "جارٍ الحفظ..." : "حفظ التغييرات"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {deleting ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-provider-title">
            <h2 id="delete-provider-title" className="text-xl font-bold">حذف {deleting.name}</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
              سيُزال الاتصال فورًا من قوائم الدردشة والوكلاء والتكاملات، وتُعطل نماذجه. تبقى سجلات التشغيل القديمة سليمة لأغراض التدقيق.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button className="secondary-button" onClick={() => setDeleting(null)} type="button">إلغاء</button>
              <button disabled={busy !== null} className="danger-button" onClick={confirmDelete} type="button">{busy ? "جارٍ الحذف..." : "حذف الاتصال"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
