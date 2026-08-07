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
  validationId?: string;
  validationExpiresAt?: string;
  verificationStatus?: "models_discovered" | "verified";
};

type ErrorPayload = {
  message?: string;
  requestId?: string;
  action?: { ar?: string };
  details?: Array<{ path?: string; code?: string; message?: string }>;
};

const categoryLabels: Record<ProviderPreset["category"], string> = {
  first_party: "المزودات الأصلية",
  cloud: "منصات السحابة",
  router: "موجّهات النماذج",
  inference: "منصات الاستدلال",
  custom: "اتصال مخصص",
};

function formString(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function errorText(error: ErrorPayload | undefined, fallback: string) {
  const details = error?.details?.map((item) => (
    item.message?.trim() || [item.path, item.code].filter(Boolean).join(": ")
  )).filter(Boolean).join("، ");
  return [
    error?.message?.trim() || fallback,
    details,
    error?.action?.ar?.trim(),
    error?.requestId ? `معرّف الطلب: ${error.requestId}` : null,
  ].filter(Boolean).join(" ");
}

export function ProviderForm() {
  const router = useRouter();
  const [providerSlug, setProviderSlug] = useState("openai");
  const preset = useMemo(() => getProviderPreset(providerSlug) ?? providerPresets[0], [providerSlug]);
  const [baseUrl, setBaseUrl] = useState(preset.defaultBaseUrl);
  const [manualModel, setManualModel] = useState(preset.starterModel ?? "");
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
    setManualModel(next.starterModel ?? "");
    resetValidation();
    setMessage(null);
  }

  async function requestValidation(
    form: FormData,
    mode: "discover" | "verify",
    selectedModel?: string,
  ): Promise<{ data: ValidationResult } | { error: string }> {
    try {
      const response = await fetch("/api/dashboard/providers/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          provider: preset.provider,
          providerSlug: preset.slug,
          baseUrl: baseUrl.trim() || undefined,
          apiKey: formString(form, "apiKey"),
          manualModel: manualModel.trim() || undefined,
          testModel: selectedModel?.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: ValidationResult;
        error?: ErrorPayload;
      } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        return { error: errorText(payload?.error, mode === "verify" ? "فشل اختبار التوليد للنموذج المحدد." : "تعذر فحص الاتصال بالمزود.") };
      }
      return { data: payload.data };
    } catch {
      return { error: "تعذر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا." };
    }
  }

  async function validate(event: FormEvent<HTMLButtonElement>) {
    const formElement = event.currentTarget.form;
    if (!formElement?.reportValidity()) return;
    const form = new FormData(formElement);
    const submittedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    setLoading("validate");
    setMessage(null);
    const checked = await requestValidation(form, "discover");
    if ("error" in checked) {
      resetValidation();
      setMessage(checked.error);
      setLoading(null);
      return;
    }

    const selected = checked.data.modelTest?.model
      ?? (manualModel.trim() && checked.data.models.includes(manualModel.trim()) ? manualModel.trim() : checked.data.models[0] ?? "");
    setValidation(checked.data);
    setTestModel(selected);
    setBaseUrl(checked.data.normalizedBaseUrl);
    const adjusted = checked.data.baseUrlAdjusted
      || submittedBaseUrl !== checked.data.normalizedBaseUrl.replace(/\/+$/, "");
    const manualStage = checked.data.stages?.some((stage) => stage.status === "manual");
    setMessage([
      adjusted ? `تم اعتماد Base URL الآمن: ${checked.data.normalizedBaseUrl}.` : null,
      `نجح الوصول إلى API وجلب ${checked.data.models.length} نموذجًا خلال ${checked.data.latencyMs}ms.`,
      manualStage ? "استُخدم اسم النموذج المقترح/اليدوي لأن المزود لا يوفر /models متوافقًا؛ سيظل الحفظ ممنوعًا حتى ينجح توليد حقيقي بهذا النموذج." : null,
      checked.data.modelTest
        ? `نجح اختبار توليد حقيقي للنموذج ${checked.data.modelTest.model}.`
        : "لم يُحفظ الاتصال بعد. اختر نموذجًا؛ زر الحفظ سينفذ اختبار توليد حقيقي ثم يحفظ كل البيانات ذريًا.",
    ].filter(Boolean).join(" "));
    setLoading(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!formElement.reportValidity()) return;
    const form = new FormData(formElement);
    if (!validation || !testModel) {
      setMessage("افحص الاتصال واجلب النماذج أولًا، ثم اختر نموذج اختبار قبل الحفظ.");
      return;
    }

    setLoading("save");
    setMessage(null);
    const verified = await requestValidation(form, "verify", testModel);
    if ("error" in verified) {
      setMessage(verified.error);
      setLoading(null);
      return;
    }
    if (!verified.data.modelTest || !verified.data.validationId) {
      setMessage("لم يُصدر الخادم إثبات فحص صالحًا. أعد اختبار النموذج ثم حاول الحفظ.");
      setLoading(null);
      return;
    }

    setValidation(verified.data);
    setTestModel(verified.data.modelTest.model);
    setBaseUrl(verified.data.normalizedBaseUrl);
    try {
      const response = await fetch("/api/dashboard/providers/verified-save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          validationId: verified.data.validationId,
          provider: preset.provider,
          providerSlug: verified.data.providerSlug,
          baseUrl: verified.data.normalizedBaseUrl,
          name: formString(form, "name"),
          apiKey: formString(form, "apiKey"),
          manualModel: manualModel.trim() || undefined,
          testModel: verified.data.modelTest.model,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: { discoveredModels?: string[]; providerLabel?: string; testedModel?: string };
        error?: ErrorPayload;
      } | null;
      if (!response.ok || !payload?.success) {
        setMessage(errorText(payload?.error, "تعذر حفظ الاتصال بعد نجاح الاختبار."));
        return;
      }

      formElement.reset();
      const initial = providerPresets[0];
      setProviderSlug(initial.slug);
      setBaseUrl(initial.defaultBaseUrl);
      setManualModel(initial.starterModel ?? "");
      resetValidation();
      setMessage(`تم اختبار ${payload.data?.providerLabel ?? preset.labelAr} وحفظ المفتاح مشفرًا داخل معاملة واحدة. النموذج المختبر: ${payload.data?.testedModel ?? testModel}. النماذج المحفوظة: ${payload.data?.discoveredModels?.length ?? 0}.`);
      router.refresh();
    } catch {
      setMessage("تعذر الوصول إلى الخادم أثناء الحفظ. لم يُسجل الاتصال جزئيًا؛ أعد المحاولة.");
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
        <p className="mt-1 text-sm leading-7 text-[var(--text-secondary)]">يجلب الفحص النماذج أولًا، ثم ينفذ الحفظ اختبار توليد فعليًا ويكتب الاعتماد والفهرس وسجل التدقيق داخل معاملة واحدة.</p>
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
        <button type="button" className="secondary-button px-3 py-2 text-xs" onClick={() => changePreset("inferx")}>استخدام InferX</button>
        <button type="button" className="secondary-button px-3 py-2 text-xs" onClick={() => changePreset("opencode-zen")}>استخدام OpenCode Zen</button>
        <button type="button" className="secondary-button px-3 py-2 text-xs" onClick={() => changePreset("agentrouter")}>استخدام AgentRouter</button>
        <button type="button" className="secondary-button px-3 py-2 text-xs" onClick={() => changePreset("openrouter")}>استخدام OpenRouter</button>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-sm sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{preset.labelAr}</strong><span className="rounded-full border border-[var(--border)] px-2 py-1 text-xs" dir="ltr">{preset.apiStyle}</span></div>
        <p className="mt-2 leading-7 text-[var(--text-secondary)]">{preset.descriptionAr}</p>
        {preset.starterModel ? <p className="mt-2 text-xs text-[var(--text-secondary)]">نموذج بدء موثق/مقترح للفحص: <code dir="ltr">{preset.starterModel}</code>. يمكن تغييره قبل التحقق.</p> : null}
      </section>

      <label className="grid gap-2 text-sm">اسم الاتصال<input name="name" required minLength={2} maxLength={80} className="form-control" placeholder={`${preset.labelAr} — الإنتاج`} /></label>
      <label className="grid gap-2 text-sm">مفتاح API<input name="apiKey" required type="password" minLength={8} maxLength={4000} autoComplete="off" dir="ltr" onChange={resetValidation} className="form-control font-mono" placeholder="••••••••••••••••" /></label>

      <label className="grid gap-2 text-sm sm:col-span-2">
        Base URL
        <input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); resetValidation(); }} required readOnly={!preset.baseUrlEditable} type="url" dir="ltr" className="form-control font-mono text-sm read-only:cursor-not-allowed read-only:opacity-75" placeholder="https://provider.example.com/v1" />
        <span className="text-xs text-[var(--text-secondary)]">{preset.baseUrlEditable ? "يمكن تغييره لنشر خاص أو منطقة سحابية أخرى." : "عنوان رسمي مثبت لهذا المزود لحماية المفتاح من التوجيه إلى نطاق خاطئ."}</span>
      </label>

      <label className="grid gap-2 text-sm sm:col-span-2">
        نموذج الفحص اليدوي — اختياري
        <input value={manualModel} onChange={(event) => { setManualModel(event.target.value); resetValidation(); }} maxLength={300} dir="ltr" className="form-control font-mono" placeholder="provider/model-name" />
        <span className="text-xs text-[var(--text-secondary)]">يُستخدم أيضًا عندما لا يوفر المزود قائمة نماذج عبر /models. لا يعتبر وجود الاسم نجاحًا؛ الحفظ يتطلب طلب توليد حقيقي ناجح.</span>
      </label>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={loading !== null} onClick={validate} className="secondary-button disabled:opacity-60" type="button">{loading === "validate" ? "جارٍ فحص الشبكة والمفتاح..." : "فحص الاتصال وجلب النماذج"}</button>
        <button disabled={!canSave} className="primary-button disabled:opacity-50" type="submit">{loading === "save" ? "جارٍ اختبار النموذج والحفظ الذري..." : "اختبر النموذج واحفظ الاتصال"}</button>
        {!validation ? <span className="text-xs text-[var(--text-secondary)]">الحفظ لا يتاح قبل اكتشاف النماذج أو تثبيت نموذج يدوي ثم اختبار التوليد.</span> : null}
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
