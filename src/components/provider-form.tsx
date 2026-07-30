"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getProviderPreset, providerPresets, type ProviderPreset } from "@/lib/providers/catalog";

export type ValidationResult = {
  providerSlug: string;
  apiStyle: string;
  normalizedBaseUrl: string;
  models: string[];
  latencyMs: number;
  baseUrlAdjusted?: boolean;
  stages?: Array<{ stage: string; status: "passed" | "manual"; latencyMs?: number }>;
  modelTest?: { model: string; latencyMs: number };
};

type ErrorPayload = {
  message?: string;
  action?: { ar?: string };
  details?: Array<{ message?: string }>;
};

const categoryLabels: Record<ProviderPreset["category"], string> = {
  first_party: "المزودات الأصلية",
  cloud: "منصات السحابة",
  router: "موجّهات النماذج",
  inference: "منصات الاستدلال",
  custom: "اتصال مخصص",
};

function errorText(error: ErrorPayload | undefined, fallback: string) {
  return [
    error?.message?.trim() || fallback,
    error?.details?.map((item) => item.message).filter(Boolean).join("، "),
    error?.action?.ar?.trim(),
  ].filter(Boolean).join(" ");
}

export function ProviderForm() {
  const router = useRouter();
  const [providerSlug, setProviderSlug] = useState("openai");
  const preset = useMemo(() => getProviderPreset(providerSlug) ?? providerPresets[0], [providerSlug]);
  const [baseUrl, setBaseUrl] = useState(preset.defaultBaseUrl);
  const [manualModel, setManualModel] = useState("");
  const [loading, setLoading] = useState<"validate" | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [testModel, setTestModel] = useState("");

  const grouped = useMemo(() => Object.entries(categoryLabels).map(([category, label]) => ({
    category: category as ProviderPreset["category"],
    label,
    providers: providerPresets.filter((item) => item.category === category),
  })), []);

  function resetValidation() {
    setValidation(null);
    setTestModel("");
  }

  function changePreset(slug: string) {
    const next = getProviderPreset(slug) ?? providerPresets[0];
    setProviderSlug(next.slug);
    setBaseUrl(next.defaultBaseUrl);
    setManualModel("");
    resetValidation();
    setMessage(null);
  }

  async function requestValidation(form: FormData) {
    setLoading("validate");
    setMessage(null);
    const submittedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    try {
      const response = await fetch("/api/dashboard/providers/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: preset.provider,
          providerSlug: preset.slug,
          baseUrl: baseUrl.trim() || undefined,
          apiKey: form.get("apiKey"),
          manualModel: manualModel.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: ValidationResult;
        error?: ErrorPayload;
      } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        resetValidation();
        setMessage(errorText(payload?.error, "تعذر فحص الاتصال بالمزود."));
        return;
      }
      const selected = manualModel.trim() && payload.data.models.includes(manualModel.trim())
        ? manualModel.trim()
        : payload.data.models[0] ?? "";
      setValidation(payload.data);
      setTestModel(selected);
      setBaseUrl(payload.data.normalizedBaseUrl);
      const adjusted = payload.data.baseUrlAdjusted
        || submittedBaseUrl !== payload.data.normalizedBaseUrl.replace(/\/+$/, "");
      const manualStage = payload.data.stages?.some((stage) => stage.status === "manual");
      setMessage([
        adjusted ? `تم اعتماد Base URL الآمن: ${payload.data.normalizedBaseUrl}.` : null,
        `نجح الاتصال خلال ${payload.data.latencyMs}ms وتم العثور على ${payload.data.models.length} نموذجًا.`,
        manualStage ? "استُخدم اسم النموذج اليدوي لأن المزود لا يوفر /models متوافقًا." : null,
        "اختر نموذج الاختبار ثم احفظ الاتصال.",
      ].filter(Boolean).join(" "));
    } catch {
      resetValidation();
      setMessage("تعذر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا.");
    } finally {
      setLoading(null);
    }
  }

  async function validate(event: FormEvent<HTMLButtonElement>) {
    const formElement = event.currentTarget.form;
    if (!formElement?.reportValidity()) return;
    await requestValidation(new FormData(formElement));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!validation || !testModel) {
      setMessage("افحص الاتصال واجلب النماذج أولًا، ثم اختر نموذج اختبار قبل الحفظ.");
      return;
    }
    setLoading("save");
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: preset.provider,
          providerSlug: preset.slug,
          baseUrl: baseUrl.trim() || undefined,
          name: form.get("name"),
          apiKey: form.get("apiKey"),
          manualModel: manualModel.trim() || undefined,
          testModel,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: { discoveredModels?: string[]; providerLabel?: string };
        error?: ErrorPayload;
      } | null;
      if (!response.ok || !payload?.success) {
        setMessage(errorText(payload?.error, "تعذر حفظ الاتصال."));
        return;
      }
      formElement.reset();
      const initial = providerPresets[0];
      setProviderSlug(initial.slug);
      setBaseUrl(initial.defaultBaseUrl);
      setManualModel("");
      resetValidation();
      setMessage(`تم اختبار ${payload.data?.providerLabel ?? preset.labelAr} وحفظ المفتاح مشفرًا. النماذج المتاحة: ${payload.data?.discoveredModels?.length ?? 0}.`);
      router.refresh();
    } catch {
      setMessage("تعذر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا.");
    } finally {
      setLoading(null);
    }
  }

  const models = validation?.models ?? [];
  const modelPreview = models.slice(0, 16);
  const canSave = Boolean(validation && testModel && loading === null);

  return (
    <form onSubmit={submit} className="soft-card grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
      <div className="sm:col-span-2">
        <h2 className="text-lg font-bold">إضافة اتصال مزود حقيقي</h2>
        <p className="mt-1 text-sm leading-7 text-[var(--text-secondary)]">اختر المنصة، أدخل مفتاحها، ثم نفّذ اتصالًا واختبار توليد حقيقيًا قبل الحفظ المشفر.</p>
      </div>

      <label className="grid gap-2 text-sm sm:col-span-2">
        منصة المزود
        <select value={providerSlug} onChange={(event) => changePreset(event.target.value)} className="form-control">
          {grouped.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.providers.map((item) => <option key={item.slug} value={item.slug}>{item.labelAr}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="button" className="secondary-button px-3 py-2 text-xs" onClick={() => changePreset("agentrouter")}>استخدام عنوان AgentRouter الرسمي</button>
        <button type="button" className="secondary-button px-3 py-2 text-xs" onClick={() => changePreset("openrouter")}>استخدام OpenRouter</button>
        <button type="button" className="secondary-button px-3 py-2 text-xs" onClick={() => changePreset("huggingface")}>استخدام Hugging Face</button>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-sm sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{preset.labelAr}</strong><span className="rounded-full border border-[var(--border)] px-2 py-1 text-xs" dir="ltr">{preset.apiStyle}</span></div>
        <p className="mt-2 leading-7 text-[var(--text-secondary)]">{preset.descriptionAr}</p>
      </section>

      <label className="grid gap-2 text-sm">اسم الاتصال<input name="name" required maxLength={80} className="form-control" placeholder={`${preset.labelAr} — الإنتاج`} /></label>
      <label className="grid gap-2 text-sm">مفتاح API<input name="apiKey" required type="password" minLength={8} maxLength={4000} autoComplete="off" dir="ltr" onChange={resetValidation} className="form-control font-mono" placeholder="••••••••••••••••" /></label>

      <label className="grid gap-2 text-sm sm:col-span-2">
        Base URL
        <input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); resetValidation(); }} required readOnly={!preset.baseUrlEditable} type="url" dir="ltr" className="form-control font-mono text-sm read-only:cursor-not-allowed read-only:opacity-75" placeholder="https://provider.example.com/v1" />
        <span className="text-xs text-[var(--text-secondary)]">{preset.baseUrlEditable ? "يمكن تغييره لنشر خاص أو منطقة سحابية أخرى." : "عنوان رسمي مثبت لهذا المزود لحماية المفتاح من التوجيه إلى نطاق خاطئ."}</span>
      </label>

      <label className="grid gap-2 text-sm sm:col-span-2">
        اسم نموذج يدوي — اختياري
        <input value={manualModel} onChange={(event) => { setManualModel(event.target.value); resetValidation(); }} maxLength={300} dir="ltr" className="form-control font-mono" placeholder="provider/model-name" />
        <span className="text-xs text-[var(--text-secondary)]">للمزودات التي لا توفر قائمة نماذج عبر /models. سيظل النموذج خاضعًا لاختبار توليد حقيقي.</span>
      </label>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={loading !== null} onClick={validate} className="secondary-button disabled:opacity-60" type="button">{loading === "validate" ? "جارٍ فحص الشبكة والمفتاح..." : "فحص الاتصال وجلب النماذج"}</button>
        <button disabled={!canSave} className="primary-button disabled:opacity-50" type="submit">{loading === "save" ? "جارٍ اختبار التوليد والحفظ..." : "اختبر واحفظ الاتصال"}</button>
        {!validation ? <span className="text-xs text-[var(--text-secondary)]">الحفظ لا يتاح قبل نجاح فحص حقيقي.</span> : null}
      </div>

      {message ? <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm sm:col-span-2" role="status">{message}</p> : null}

      {validation ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--primary-soft)] p-4 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">النماذج المتاحة فعليًا</h3><span className="text-xs text-[var(--text-secondary)]">{models.length} نموذج — {validation.latencyMs}ms</span></div>
          <div className="mt-4 flex max-h-44 flex-wrap gap-2 overflow-y-auto" dir="ltr">
            {modelPreview.map((model) => <span key={model} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-xs">{model}</span>)}
            {models.length > modelPreview.length ? <span className="px-2 py-1 text-xs">+{models.length - modelPreview.length}</span> : null}
          </div>
          <label className="mt-4 grid gap-2 text-sm">نموذج اختبار التوليد قبل الحفظ<select value={testModel} onChange={(event) => setTestModel(event.target.value)} required dir="ltr" className="form-control font-mono text-sm">{models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
        </section>
      ) : null}
    </form>
  );
}
