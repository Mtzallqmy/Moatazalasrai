"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Provider = "openai" | "anthropic" | "gemini" | "openai_compatible";

type ValidationResult = {
  normalizedBaseUrl: string;
  models: string[];
  latencyMs: number;
  baseUrlAdjusted?: boolean;
};

type ErrorPayload = {
  message?: string;
  code?: string;
  action?: { ar?: string };
  details?: Array<{ path?: string }>;
};

const AGENTROUTER_BASE_URL = "https://co.agentrouter.org/v1";

const defaults: Record<Provider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openai_compatible: "",
};

function errorText(error: ErrorPayload | undefined, fallback: string) {
  if (!error) return fallback;
  const action = error.action?.ar?.trim();
  return [error.message?.trim() || fallback, action].filter(Boolean).join(" ");
}

export function ProviderForm() {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("openai");
  const [baseUrl, setBaseUrl] = useState(defaults.openai);
  const [loading, setLoading] = useState<"validate" | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [testModel, setTestModel] = useState("");

  const modelPreview = useMemo(() => validation?.models.slice(0, 12) ?? [], [validation]);
  const canSave = Boolean(validation && testModel && loading === null);

  function resetValidation() {
    setValidation(null);
    setTestModel("");
  }

  function changeProvider(value: Provider) {
    setProvider(value);
    setBaseUrl(defaults[value]);
    resetValidation();
    setMessage(null);
  }

  function useAgentRouter() {
    setProvider("openai_compatible");
    setBaseUrl(AGENTROUTER_BASE_URL);
    resetValidation();
    setMessage("تم ضبط عنوان AgentRouter الرسمي. أدخل المفتاح ثم افحص الاتصال لجلب النماذج.");
  }

  async function requestValidation(form: FormData): Promise<ValidationResult | null> {
    setLoading("validate");
    setMessage(null);
    const submittedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    try {
      const response = await fetch("/api/dashboard/providers/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, baseUrl, apiKey: form.get("apiKey") }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: ValidationResult;
        error?: ErrorPayload;
      } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        resetValidation();
        setMessage(errorText(payload?.error, "تعذر فحص الاتصال بالمزود."));
        return null;
      }
      setValidation(payload.data);
      setTestModel(payload.data.models[0] ?? "");
      setBaseUrl(payload.data.normalizedBaseUrl);
      const adjusted = payload.data.baseUrlAdjusted
        || submittedBaseUrl !== payload.data.normalizedBaseUrl.replace(/\/+$/, "");
      setMessage(`${adjusted ? `تم تصحيح Base URL إلى ${payload.data.normalizedBaseUrl}. ` : ""}نجح الاتصال خلال ${payload.data.latencyMs}ms وتم العثور على ${payload.data.models.length} نموذجًا. اختر نموذج الاختبار ثم احفظ.`);
      return payload.data;
    } catch {
      resetValidation();
      setMessage("تعذر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا.");
      return null;
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
    const form = new FormData(event.currentTarget);
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
          provider,
          baseUrl,
          name: form.get("name"),
          apiKey: form.get("apiKey"),
          testModel,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        data?: { discoveredModels?: string[] };
        error?: ErrorPayload;
      } | null;
      if (!response.ok || !payload?.success) {
        setMessage(errorText(payload?.error, "تعذر حفظ الاتصال."));
        return;
      }
      event.currentTarget.reset();
      setProvider("openai");
      setBaseUrl(defaults.openai);
      resetValidation();
      setMessage(`تم التحقق والحفظ المشفر بنجاح. النماذج المكتشفة: ${payload.data?.discoveredModels?.length ?? 0}.`);
      router.refresh();
    } catch {
      setMessage("تعذر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <form onSubmit={submit} className="soft-card grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
      <div className="sm:col-span-2">
        <h2 className="text-lg font-bold text-stone-100">إضافة اتصال مزود فعلي</h2>
        <p className="mt-1 text-sm leading-7 text-stone-400">أدخل المفتاح وBase URL، ثم افحص الاتصال لجلب النماذج الحقيقية قبل الحفظ المشفر.</p>
      </div>

      <label className="grid gap-2 text-sm text-stone-300">
        نوع المزود
        <select value={provider} onChange={(event) => changeProvider(event.target.value as Provider)} className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 outline-none focus:border-emerald-200/60">
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Google Gemini</option>
          <option value="openai_compatible">OpenAI-compatible / مزود مخصص</option>
        </select>
      </label>

      <label className="grid gap-2 text-sm text-stone-300">
        اسم الاتصال
        <input name="name" required maxLength={80} className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 outline-none focus:border-emerald-200/60" placeholder="اتصال الإنتاج" />
      </label>

      <label className="grid gap-2 text-sm text-stone-300 sm:col-span-2">
        Base URL
        <input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); resetValidation(); }} required type="url" dir="ltr" className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 font-mono text-sm outline-none focus:border-emerald-200/60" placeholder="https://provider.example.com/v1" />
      </label>

      {provider === "openai_compatible" ? (
        <div className="sm:col-span-2">
          <button type="button" onClick={useAgentRouter} disabled={loading !== null} className="secondary-button px-3 py-2 text-xs disabled:opacity-60">استخدام عنوان AgentRouter الرسمي</button>
          <p className="mt-2 text-xs text-stone-400" dir="ltr">{AGENTROUTER_BASE_URL}</p>
        </div>
      ) : null}

      <label className="grid gap-2 text-sm text-stone-300 sm:col-span-2">
        مفتاح API
        <input name="apiKey" required type="password" minLength={8} maxLength={1000} autoComplete="off" dir="ltr" onChange={resetValidation} className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 font-mono outline-none focus:border-emerald-200/60" placeholder="••••••••••••••••" />
      </label>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={loading !== null} onClick={validate} className="secondary-button disabled:cursor-not-allowed disabled:opacity-60" type="button">{loading === "validate" ? "جارٍ الفحص..." : "فحص الاتصال وجلب النماذج"}</button>
        <button disabled={!canSave} className="primary-button disabled:cursor-not-allowed disabled:opacity-50" type="submit">{loading === "save" ? "جارٍ التحقق والحفظ..." : "تحقق واحفظ الاتصال"}</button>
        {!validation ? <span className="text-xs text-stone-400">يُفعّل الحفظ بعد نجاح جلب النماذج.</span> : null}
      </div>

      {message ? <p className="rounded-2xl border border-stone-700 bg-stone-950/50 px-4 py-3 text-sm text-stone-200 sm:col-span-2" role="status">{message}</p> : null}

      {validation ? (
        <section className="rounded-2xl border border-emerald-200/20 bg-emerald-100/5 p-4 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold text-emerald-100">النماذج المتاحة فعليًا</h3>
            <span className="text-xs text-stone-400">{validation.models.length} نموذج — {validation.latencyMs}ms</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2" dir="ltr">
            {modelPreview.map((model) => <span key={model} className="rounded-full border border-stone-700 bg-stone-950/60 px-3 py-1 font-mono text-xs text-stone-300">{model}</span>)}
            {validation.models.length > modelPreview.length ? <span className="px-2 py-1 text-xs text-stone-500">+{validation.models.length - modelPreview.length}</span> : null}
          </div>
          <label className="mt-4 grid gap-2 text-sm text-stone-300">
            نموذج اختبار التوليد قبل الحفظ
            <select value={testModel} onChange={(event) => setTestModel(event.target.value)} required dir="ltr" className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 font-mono text-sm">
              {validation.models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
        </section>
      ) : null}
    </form>
  );
}
