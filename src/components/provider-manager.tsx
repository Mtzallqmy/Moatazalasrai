"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type ProviderSummary = {
  id: string;
  provider: string;
  name: string;
  baseUrl: string;
  secretHint: string;
  discoveredModels: string[];
  validationStatus: "pending" | "verified" | "failed";
  lastValidatedAt: string | null;
  lastValidationLatencyMs: number | null;
  lastErrorCode: string | null;
  enabled: boolean;
  createdAt: string;
};

type Action = "toggle" | "revalidate" | "edit" | "delete";

export function ProviderManager({ initialProviders }: { initialProviders: ProviderSummary[] }) {
  const router = useRouter();
  const [providers, setProviders] = useState(initialProviders);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [editing, setEditing] = useState<ProviderSummary | null>(null);
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
        data?: ProviderSummary & { deleted?: boolean };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        setMessage(payload?.error?.message ?? "تعذر إكمال الإجراء.");
        return false;
      }
      if (method === "DELETE") {
        setProviders((items) => items.filter((item) => item.id !== id));
      } else {
        setProviders((items) => items.map((item) => item.id === id ? payload.data as ProviderSummary : item));
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

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const testModel = String(form.get("testModel") ?? "").trim();
    const ok = await mutate(editing.id, "edit", {
      id: editing.id,
      name: form.get("name"),
      baseUrl: form.get("baseUrl"),
      ...(apiKey ? { apiKey } : {}),
      ...(apiKey && testModel ? { testModel } : {}),
    });
    if (ok) {
      setEditing(null);
      setMessage("تم تحديث الاتصال بأمان.");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const ok = await mutate(deleting.id, "delete", { id: deleting.id }, "DELETE");
    if (ok) {
      setDeleting(null);
      setMessage("تم حذف اتصال المزود.");
    }
  }

  return (
    <section className="soft-card mt-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">الاتصالات المحفوظة</h2>
          <p className="mt-1 text-sm text-stone-400">إدارة الحالة، إعادة الفحص، تغيير المفتاح، والبحث في النماذج المكتشفة.</p>
        </div>
        <label className="grid gap-1 text-xs text-stone-400">
          البحث في النماذج
          <input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} className="rounded-xl border border-stone-700 bg-stone-950/70 px-3 py-2 text-sm text-stone-100" placeholder="اسم النموذج" />
        </label>
      </div>
      {message ? <p className="mt-4 rounded-2xl border border-stone-700 bg-stone-950/50 px-4 py-3 text-sm" role="status">{message}</p> : null}
      {providers.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-stone-700 p-10 text-center text-sm text-stone-400">لم تتم إضافة مزود بعد.</p>
      ) : (
        <>
          <p className="mt-4 text-xs text-stone-500">النتائج المطابقة: {filteredModelCount} نموذج</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {providers.map((provider) => {
              const models = provider.discoveredModels.filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase()));
              const isBusy = busy?.id === provider.id;
              return (
                <article key={provider.id} className="rounded-2xl border border-stone-700/70 bg-stone-950/45 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-latin text-xs uppercase tracking-wider text-emerald-100" dir="ltr">{provider.provider}</p>
                      <h3 className="mt-1 font-bold">{provider.name}</h3>
                    </div>
                    <span className={`status-badge ${provider.enabled && provider.validationStatus === "verified" ? "status-success" : "status-error"}`}>
                      {provider.enabled && provider.validationStatus === "verified" ? "مفعّل ومتحقق" : provider.validationStatus === "failed" ? "فشل الفحص" : "غير مفعّل"}
                    </span>
                  </div>
                  <p className="mt-4 break-all font-mono text-xs text-stone-400" dir="ltr">{provider.baseUrl}</p>
                  <p className="mt-2 font-mono text-sm" dir="ltr">{provider.secretHint}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={isBusy} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => mutate(provider.id, "toggle", { id: provider.id, enabled: !provider.enabled })}>
                      {busy?.id === provider.id && busy.action === "toggle" ? "جارٍ التحديث..." : provider.enabled ? "تعطيل" : "تفعيل"}
                    </button>
                    <button disabled={isBusy || provider.discoveredModels.length === 0} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => mutate(provider.id, "revalidate", { id: provider.id, revalidate: true, testModel: provider.discoveredModels[0] })}>
                      {busy?.id === provider.id && busy.action === "revalidate" ? "جارٍ الفحص..." : "إعادة الفحص واختبار نموذج"}
                    </button>
                    <button disabled={isBusy} className="secondary-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => setEditing(provider)}>تعديل</button>
                    <button disabled={isBusy} className="danger-button px-3 py-2 text-xs disabled:opacity-50" onClick={() => setDeleting(provider)}>حذف</button>
                  </div>
                  <details className="mt-4 rounded-2xl border border-stone-700 bg-stone-950/60 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-emerald-100">النماذج ({models.length})</summary>
                    <div className="mt-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto" dir="ltr">
                      {models.map((model) => <span key={model} className="rounded-full border border-stone-700 px-2.5 py-1 font-mono text-xs text-stone-300">{model}</span>)}
                      {models.length === 0 ? <span className="text-xs text-stone-500">لا توجد نتائج مطابقة.</span> : null}
                    </div>
                  </details>
                  <p className="mt-3 text-xs text-stone-500">
                    آخر فحص: {provider.lastValidatedAt ? new Date(provider.lastValidatedAt).toLocaleString("ar") : "غير متاح"}
                    {provider.lastValidationLatencyMs === null ? "" : ` — ${provider.lastValidationLatencyMs}ms`}
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
            <form onSubmit={saveEdit} className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm">الاسم<input name="name" defaultValue={editing.name} required maxLength={80} className="form-control" /></label>
              <label className="grid gap-2 text-sm">Base URL<input name="baseUrl" type="url" dir="ltr" defaultValue={editing.baseUrl} required className="form-control font-mono" /></label>
              <label className="grid gap-2 text-sm">مفتاح جديد (اختياري)<input name="apiKey" type="password" minLength={8} maxLength={1000} className="form-control font-mono" /></label>
              <label className="grid gap-2 text-sm">نموذج الاختبار<select name="testModel" dir="ltr" className="form-control font-mono">{editing.discoveredModels.map((model) => <option key={model}>{model}</option>)}</select></label>
              <div className="flex justify-end gap-2">
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>إلغاء</button>
                <button disabled={busy !== null} className="primary-button">{busy ? "جارٍ الحفظ..." : "حفظ التغييرات"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {deleting ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-provider-title">
            <h2 id="delete-provider-title" className="text-xl font-bold">تأكيد حذف المزود</h2>
            <p className="mt-3 text-sm leading-7 text-stone-400">سيُرفض الحذف إن كان الاتصال مستخدمًا في أي إصدار وكيل. لن يمكن استعادة المفتاح المشفر بعد الحذف.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button className="secondary-button" onClick={() => setDeleting(null)}>إلغاء</button>
              <button disabled={busy !== null} className="danger-button" onClick={confirmDelete}>{busy ? "جارٍ الحذف..." : "حذف نهائي"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
