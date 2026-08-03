"use client";

import { type FormEvent, type MouseEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Select } from "@/components/ui";

type TargetProvider = "openai" | "anthropic" | "gemini";
type TransportMode = "cloudflare_ai_gateway_native" | "cloudflare_ai_gateway_rest" | "cloudflare_workers_ai";
type CredentialMode = "encrypted_byok" | "cloudflare_provider_key" | "cloudflare_binding";

type ValidationResult = {
  providerSlug: string;
  providerTypeId: string;
  transportMode: TransportMode;
  credentialMode: CredentialMode;
  normalizedBaseUrl: string;
  models: string[];
  latencyMs: number;
  modelTest?: { model: string; latencyMs: number };
  validationId?: string;
};

type ApiErrorPayload = {
  message?: string;
  requestId?: string;
  details?: Array<{ message?: string }>;
};

const providerMetadata: Record<TargetProvider, { slug: string; baseUrl: string; label: string }> = {
  openai: { slug: "openai", baseUrl: "https://api.openai.com/v1", label: "OpenAI" },
  anthropic: { slug: "anthropic", baseUrl: "https://api.anthropic.com", label: "Anthropic" },
  gemini: { slug: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", label: "Google AI Studio" },
};

function errorText(error: ApiErrorPayload | undefined, fallback: string) {
  return [
    error?.message?.trim() || fallback,
    error?.details?.map((item) => item.message).filter(Boolean).join("، "),
    error?.requestId ? `معرّف الطلب: ${error.requestId}` : null,
  ].filter(Boolean).join(" ");
}

export function CloudflareProviderForm() {
  const router = useRouter();
  const [transportMode, setTransportMode] = useState<TransportMode>("cloudflare_ai_gateway_native");
  const [targetProvider, setTargetProvider] = useState<TargetProvider>("openai");
  const [credentialMode, setCredentialMode] = useState<CredentialMode>("cloudflare_provider_key");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState<"discover" | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const effectiveCredentialMode: CredentialMode = transportMode === "cloudflare_ai_gateway_native"
    ? credentialMode
    : "cloudflare_binding";
  const providerTypeId = transportMode === "cloudflare_workers_ai"
    ? "cloudflare-workers-ai"
    : "cloudflare-ai-gateway";
  const provider = transportMode === "cloudflare_workers_ai" ? "openai" : targetProvider;
  const providerMeta = providerMetadata[targetProvider];
  const requiresModelBeforeValidation = transportMode !== "cloudflare_ai_gateway_native";
  const showProviderKeyChoice = transportMode === "cloudflare_ai_gateway_native";
  const showApiKey = showProviderKeyChoice && effectiveCredentialMode === "encrypted_byok";
  const showKeyAlias = showProviderKeyChoice && effectiveCredentialMode === "cloudflare_provider_key";
  const transportDescription = useMemo(() => {
    if (transportMode === "cloudflare_workers_ai") {
      return "ينفذ النموذج عبر binding باسم AI داخل Cloudflare Worker. لا يقبل BYOK لمزود خارجي في هذا المسار.";
    }
    if (transportMode === "cloudflare_ai_gateway_rest") {
      return "ينفذ الطلب عبر AI Gateway REST API باستخدام Cloudflare API Token محفوظ كسر خادمي.";
    }
    return "يوجه endpoint الأصلي للمزود عبر AI Gateway، مع مفتاح مشفر في المنصة أو Provider Key Alias محفوظ في Cloudflare.";
  }, [transportMode]);

  function changeTransport(next: TransportMode) {
    setTransportMode(next);
    setCredentialMode(next === "cloudflare_ai_gateway_native" ? "cloudflare_provider_key" : "cloudflare_binding");
    setModels([]);
    setSelectedModel("");
    setValidation(null);
    setMessage(null);
  }

  function payload(form: FormData, mode: "discover" | "verify") {
    const gatewayId = String(form.get("gatewayId") ?? "").trim();
    const model = String(form.get("model") ?? "").trim();
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const keyAlias = String(form.get("keyAlias") ?? "").trim();
    const cacheTtlRaw = String(form.get("cacheTtl") ?? "").trim();
    return {
      mode,
      provider,
      providerTypeId,
      providerSlug: transportMode === "cloudflare_workers_ai" ? "cloudflare-workers-ai" : providerMeta.slug,
      transportMode,
      credentialMode: effectiveCredentialMode,
      baseUrl: transportMode === "cloudflare_ai_gateway_native" ? providerMeta.baseUrl : undefined,
      gatewayId: gatewayId || undefined,
      keyAlias: keyAlias || undefined,
      apiKey: apiKey || undefined,
      manualModel: model || undefined,
      defaultModel: model || undefined,
      testModel: mode === "verify" ? (selectedModel || model || undefined) : undefined,
      allowedModels: model ? [model] : [],
      skipCache: form.get("skipCache") === "on",
      cacheTtl: cacheTtlRaw ? Number(cacheTtlRaw) : undefined,
      collectLog: form.get("collectLog") === "on",
    };
  }

  async function validate(event: MouseEvent<HTMLButtonElement>) {
    const formElement = event.currentTarget.form;
    if (!formElement?.reportValidity()) return;
    const form = new FormData(formElement);
    const model = String(form.get("model") ?? "").trim();
    if (requiresModelBeforeValidation && !model) {
      setMessage(transportMode === "cloudflare_workers_ai"
        ? "أدخل معرف نموذج Workers AI الرسمي الذي يبدأ بـ@cf/."
        : "أدخل اسم النموذج بصيغة المزود/النموذج التي يقبلها AI Gateway REST.");
      return;
    }
    setLoading("discover");
    setMessage(null);
    setValidation(null);
    try {
      const response = await fetch("/api/dashboard/providers/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(form, "discover")),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; data?: ValidationResult; error?: ApiErrorPayload } | null;
      if (!response.ok || !result?.success || !result.data) {
        setMessage(errorText(result?.error, "تعذر التحقق من إعداد Cloudflare."));
        return;
      }
      const discovered = result.data.models;
      const nextModel = model || result.data.modelTest?.model || discovered[0] || "";
      setValidation(result.data);
      setModels(discovered);
      setSelectedModel(nextModel);
      setMessage(`تم التحقق من مسار Cloudflare دون حفظ الإعداد. النماذج المتاحة: ${discovered.length}. زمن الفحص: ${result.data.latencyMs}ms.`);
    } catch {
      setMessage("تعذر الوصول إلى الخادم. لم يتم حفظ أي إعداد.");
    } finally {
      setLoading(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!formElement.reportValidity()) return;
    const form = new FormData(formElement);
    if (!validation || !selectedModel) {
      setMessage("نفّذ فحص الاتصال واختر نموذجًا قبل الحفظ.");
      return;
    }
    setLoading("save");
    setMessage(null);
    try {
      const verifyResponse = await fetch("/api/dashboard/providers/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(form, "verify")),
      });
      const verified = await verifyResponse.json().catch(() => null) as { success?: boolean; data?: ValidationResult; error?: ApiErrorPayload } | null;
      if (!verifyResponse.ok || !verified?.success || !verified.data?.validationId || !verified.data.modelTest) {
        setMessage(errorText(verified?.error, "فشل اختبار التوليد الحقيقي؛ لم يتم حفظ المزود."));
        return;
      }
      const base = payload(form, "verify");
      const response = await fetch("/api/dashboard/providers/verified-save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...base,
          mode: undefined,
          validationId: verified.data.validationId,
          name: String(form.get("name") ?? "").trim(),
          testModel: verified.data.modelTest.model,
          defaultModel: verified.data.modelTest.model,
          allowedModels: [...new Set([...models, verified.data.modelTest.model])],
          isDefault: form.get("isDefault") === "on",
        }),
      });
      const saved = await response.json().catch(() => null) as { success?: boolean; error?: ApiErrorPayload } | null;
      if (!response.ok || !saved?.success) {
        setMessage(errorText(saved?.error, "نجح الاختبار لكن تعذر الحفظ الذري؛ لم يُنشأ سجل جزئي."));
        return;
      }
      formElement.reset();
      setModels([]);
      setSelectedModel("");
      setValidation(null);
      setMessage("تم اختبار إعداد Cloudflare وحفظ مرجع السر والحالة الصحية دون تخزين قيمة سر Cloudflare داخل سجل المزود.");
      router.refresh();
    } catch {
      setMessage("تعذر الوصول إلى الخادم. لم يتم الادعاء بنجاح الاتصال أو الحفظ.");
    } finally {
      setLoading(null);
    }
  }

  return <Card className="mt-5 p-5 sm:p-6">
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <h2 className="text-lg font-bold">إضافة مزود عبر Cloudflare</h2>
        <p className="mt-1 text-sm leading-7 text-[var(--text-secondary)]">{transportDescription}</p>
      </div>

      <label className="grid gap-2 text-sm">
        مسار التنفيذ
        <Select value={transportMode} onChange={(event) => changeTransport(event.target.value as TransportMode)}>
          <option value="cloudflare_ai_gateway_native">AI Gateway — endpoint أصلي</option>
          <option value="cloudflare_ai_gateway_rest">AI Gateway REST API</option>
          <option value="cloudflare_workers_ai">Workers AI binding</option>
        </Select>
      </label>

      <label className="grid gap-2 text-sm">
        اسم الاتصال
        <Input name="name" required minLength={2} maxLength={80} placeholder="Cloudflare Production" />
      </label>

      {transportMode !== "cloudflare_workers_ai" ? <label className="grid gap-2 text-sm">
        المزود الهدف
        <Select value={targetProvider} onChange={(event) => {
          setTargetProvider(event.target.value as TargetProvider);
          setValidation(null);
          setModels([]);
        }}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Google AI Studio</option>
        </Select>
      </label> : null}

      <label className="grid gap-2 text-sm">
        Gateway ID
        <Input name="gatewayId" required={transportMode !== "cloudflare_workers_ai"} maxLength={96} dir="ltr" placeholder="production-gateway" />
      </label>

      {showProviderKeyChoice ? <label className="grid gap-2 text-sm">
        مرجع بيانات الاعتماد
        <Select value={credentialMode} onChange={(event) => {
          setCredentialMode(event.target.value as CredentialMode);
          setValidation(null);
        }}>
          <option value="cloudflare_provider_key">Provider Key Alias في Cloudflare</option>
          <option value="encrypted_byok">مفتاح BYOK مشفر في المنصة</option>
        </Select>
      </label> : null}

      {showKeyAlias ? <label className="grid gap-2 text-sm">
        Provider Key Alias
        <Input name="keyAlias" required maxLength={96} dir="ltr" autoComplete="off" placeholder="openai-primary" />
      </label> : null}

      {showApiKey ? <label className="grid gap-2 text-sm">
        API Key
        <Input name="apiKey" type="password" required minLength={8} maxLength={4000} dir="ltr" autoComplete="new-password" />
      </label> : null}

      <label className="grid gap-2 text-sm sm:col-span-2">
        النموذج
        {models.length > 0 ? <Select name="model" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} dir="ltr">
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
        </Select> : <Input
          name="model"
          required={requiresModelBeforeValidation}
          maxLength={300}
          dir="ltr"
          placeholder={transportMode === "cloudflare_workers_ai" ? "@cf/meta/llama-3.1-8b-instruct" : "provider/model"}
        />}
      </label>

      <label className="grid gap-2 text-sm">
        Cache TTL — اختياري
        <Input name="cacheTtl" type="number" min={0} max={31_536_000} inputMode="numeric" />
      </label>
      <div className="grid content-end gap-2 text-sm">
        <label className="flex items-center gap-2"><input name="skipCache" type="checkbox" defaultChecked /> تجاوز cache عند الفحص</label>
        <label className="flex items-center gap-2"><input name="collectLog" type="checkbox" /> السماح لـCloudflare بجمع سجل الطلب وفق سياسة الخصوصية</label>
        <label className="flex items-center gap-2"><input name="isDefault" type="checkbox" /> جعله المزود الافتراضي للمؤسسة</label>
      </div>

      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" disabled={loading !== null} onClick={(event) => void validate(event)}>
          {loading === "discover" ? "جارٍ الفحص..." : "فحص الاتصال والنماذج"}
        </Button>
        <Button type="submit" disabled={!validation || !selectedModel || loading !== null}>
          {loading === "save" ? "جارٍ الاختبار والحفظ..." : "اختبار فعلي ثم حفظ"}
        </Button>
      </div>
      {message ? <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm sm:col-span-2" role="status">{message}</p> : null}
    </form>
  </Card>;
}
