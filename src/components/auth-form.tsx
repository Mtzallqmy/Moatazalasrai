"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!response.ok) throw new Error(result?.error?.message ?? "تعذر إكمال العملية.");
      router.push("/dashboard");
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
        <>
          <Field name="name" label="الاسم الكامل" minLength={2} autoComplete="name" />
          <Field name="organizationName" label="اسم المؤسسة" minLength={2} autoComplete="organization" />
        </>
      )}
      <Field name="email" label="البريد الإلكتروني" type="email" autoComplete="email" />
      <Field name="password" label="كلمة المرور" type="password" minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} />

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <button disabled={loading} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
        {loading ? "جارٍ التنفيذ..." : mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب والمؤسسة"}
      </button>
    </form>
  );
}

function Field(props: { name: string; label: string; type?: string; minLength?: number; autoComplete?: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{props.label}</span>
      <input {...props} required className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
    </label>
  );
}
