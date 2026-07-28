"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ProviderForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/dashboard/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: form.get("provider"),
        name: form.get("name"),
        apiKey: form.get("apiKey"),
      }),
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
    setLoading(false);
    if (!response.ok || !payload?.success) {
      setMessage(payload?.error?.message ?? "تعذر حفظ المفتاح.");
      return;
    }
    event.currentTarget.reset();
    setMessage("تم حفظ المفتاح مشفرًا. لن تظهر قيمته الأصلية مرة أخرى.");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="soft-card grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
      <div className="sm:col-span-2">
        <h2 className="text-lg font-bold text-stone-100">إضافة مزود نماذج</h2>
        <p className="mt-1 text-sm text-stone-400">يُرسل المفتاح إلى Backend فقط ويُحفظ باستخدام AES-256-GCM.</p>
      </div>
      <label className="grid gap-2 text-sm text-stone-300">
        المزود
        <select name="provider" required className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 outline-none focus:border-emerald-200/60">
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Google Gemini</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm text-stone-300">
        اسم الاتصال
        <input name="name" required maxLength={80} className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 outline-none focus:border-emerald-200/60" placeholder="مفتاح الإنتاج" />
      </label>
      <label className="grid gap-2 text-sm text-stone-300 sm:col-span-2">
        مفتاح API
        <input name="apiKey" required type="password" minLength={8} maxLength={500} autoComplete="off" dir="ltr" className="rounded-2xl border border-stone-700 bg-stone-950/70 px-4 py-3 font-mono outline-none focus:border-emerald-200/60" placeholder="••••••••••••••••" />
      </label>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <button disabled={loading} className="primary-button disabled:cursor-not-allowed disabled:opacity-60" type="submit">{loading ? "جارٍ الحفظ..." : "حفظ المفتاح المشفر"}</button>
        {message ? <p className="text-sm text-stone-300" role="status">{message}</p> : null}
      </div>
    </form>
  );
}
