"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { TurnstileWidget } from "@/components/turnstile-widget";

type Mode = "login" | "register";

export function AuthForm({ mode, turnstileSiteKey }: { mode: Mode; turnstileSiteKey?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [turnstileReset, setTurnstileReset] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        if (mode === "login" && result?.error?.code === "MFA_REQUIRED") {
          setMfaRequired(true);
          setTurnstileReset((value) => value + 1);
          setError("أدخل رمز تطبيق المصادقة أو أحد رموز الاسترداد.");
          return;
        }
        setTurnstileReset((value) => value + 1);
        throw new Error(result?.error?.message ?? "تعذر إكمال العملية.");
      }
      setMfaRequired(false);
      router.push(result?.data?.organizationSelectionRequired ? "/select-organization" : "/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {mode === "register" && (
        <Field name="name" label="الاسم الكامل" minLength={2} maxLength={100} autoComplete="name" />
      )}
      <Field name="email" label="البريد الإلكتروني" type="email" maxLength={320} autoComplete="email" />
      <Field name="password" label="كلمة المرور" type="password" minLength={mode === "login" ? 1 : 12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      {mode === "login" && mfaRequired ? (
        <Field
          name="mfaCode"
          label="رمز المصادقة متعددة العوامل"
          minLength={6}
          maxLength={32}
          autoComplete="one-time-code"
          inputMode="text"
          placeholder="123456 أو رمز الاسترداد"
          autoFocus
        />
      ) : null}
      {turnstileSiteKey ? <TurnstileWidget key={`${mode}-${turnstileReset}`} siteKey={turnstileSiteKey} action={mode} /> : null}

      {error && <p role="alert" className="rounded-2xl border border-rose-200/20 bg-rose-200/10 px-4 py-3 text-sm text-rose-100">{error}</p>}

      <button disabled={loading} className="primary-button w-full disabled:cursor-not-allowed disabled:opacity-60">
        {loading ? "جارٍ التنفيذ..." : mfaRequired ? "تحقق وسجّل الدخول" : mode === "login" ? "تسجيل الدخول" : "إنشاء حساب مستخدم"}
      </button>
    </form>
  );
}

function Field(props: {
  name: string;
  label: string;
  type?: string;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
  inputMode?: "text" | "numeric";
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { label, ...inputProps } = props;
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-stone-300">{label}</span>
      <input {...inputProps} required className="w-full rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-emerald-200/60 focus:ring-4 focus:ring-emerald-100/10" />
    </label>
  );
}
