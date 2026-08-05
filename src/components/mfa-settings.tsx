"use client";

import { useEffect, useState } from "react";

type Status = {
  configured: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  lockedUntil: string | null;
};
type Enrollment = { secret: string; uri: string; recoveryCodes: string[] };

function unwrap(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
}

export function MfaSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/dashboard/security/mfa", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل حالة MFA.");
    setStatus(unwrap(json) as unknown as Status);
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/dashboard/security/mfa", { cache: "no-store" }).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل حالة MFA.");
      if (active) setStatus(unwrap(json) as unknown as Status);
    }).catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, []);

  async function request(operation: Record<string, unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/dashboard/security/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(operation),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || "فشلت العملية الأمنية.");
      const data = unwrap(json);
      if (operation.operation === "begin") {
        const next = data as unknown as Enrollment;
        setEnrollment(next);
        setRecoveryCodes(next.recoveryCodes ?? []);
      } else if (operation.operation === "regenerate_recovery") {
        setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes.filter((item): item is string => typeof item === "string") : []);
      } else if (operation.operation === "confirm") {
        setEnrollment(null);
      } else if (operation.operation === "disable") {
        setEnrollment(null);
        setRecoveryCodes([]);
      }
      setNotice(success);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشلت العملية الأمنية.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="mt-6 rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-950">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">المصادقة متعددة العوامل</h2><p className="mt-1 text-sm text-slate-500">TOTP مع منع إعادة الاستخدام ورموز استرداد أحادية الاستخدام.</p></div>
      <span className={`rounded-full px-3 py-1 text-xs ${status?.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>{status?.enabled ? "مفعلة" : "غير مفعلة"}</span>
    </div>

    {!status?.enabled && !enrollment ? <form action={async (form) => request({ operation: "begin", password: form.get("password") }, "تم إنشاء مفتاح MFA. أكمل التحقق لتفعيله.")} className="mt-5 space-y-3"><label className="block text-sm">كلمة المرور الحالية<input name="password" type="password" autoComplete="current-password" required className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /></label><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-white">بدء الإعداد</button></form> : null}

    {enrollment ? <div className="mt-5 space-y-4 rounded-xl bg-slate-50 p-5 dark:bg-slate-900">
      <div><p className="text-sm font-semibold">أضف الحساب يدويًا في تطبيق المصادقة</p><code className="mt-2 block break-all rounded-lg bg-white p-3 text-xs dark:bg-slate-950" dir="ltr">{enrollment.secret}</code></div>
      <details><summary className="cursor-pointer text-sm">عرض رابط otpauth المتقدم</summary><code className="mt-2 block break-all text-xs" dir="ltr">{enrollment.uri}</code></details>
      <form action={async (form) => request({ operation: "confirm", code: form.get("code") }, "تم تفعيل MFA بنجاح.")} className="flex flex-wrap gap-2"><input name="code" required minLength={6} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="رمز 6 أرقام" className="min-w-48 flex-1 rounded-lg border px-3 py-2 dark:bg-slate-950" /><button disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-white">تأكيد التفعيل</button></form>
    </div> : null}

    {status?.enabled ? <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <form action={async (form) => request({ operation: "regenerate_recovery", password: form.get("password"), code: form.get("code") }, "تم إنشاء رموز استرداد جديدة وإبطال القديمة.")} className="space-y-3 rounded-xl border p-4 dark:border-slate-800"><h3 className="font-semibold">تجديد رموز الاسترداد</h3><input name="password" type="password" autoComplete="current-password" required placeholder="كلمة المرور الحالية" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="code" required minLength={6} maxLength={32} placeholder="رمز MFA حالي" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /><button disabled={busy} className="rounded-lg border px-4 py-2">تجديد الرموز</button></form>
      <form action={async (form) => request({ operation: "disable", password: form.get("password"), code: form.get("code") }, "تم تعطيل MFA.")} className="space-y-3 rounded-xl border border-red-200 p-4 dark:border-red-900"><h3 className="font-semibold text-red-700">تعطيل MFA</h3><input name="password" type="password" autoComplete="current-password" required placeholder="كلمة المرور الحالية" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /><input name="code" required minLength={6} maxLength={32} placeholder="رمز MFA أو الاسترداد" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /><button disabled={busy} className="rounded-lg bg-red-700 px-4 py-2 text-white">تعطيل</button></form>
    </div> : null}

    {recoveryCodes.length ? <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950"><h3 className="font-semibold">احفظ رموز الاسترداد الآن</h3><p className="mt-1 text-sm">لن تظهر مرة أخرى، وكل رمز صالح لاستخدام واحد.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{recoveryCodes.map((code) => <code key={code} dir="ltr" className="rounded bg-white px-3 py-2 text-center">{code}</code>)}</div></div> : null}

    {status?.enabled ? <p className="mt-4 text-xs text-slate-500">رموز الاسترداد المتبقية: {status.recoveryCodesRemaining}{status.lockedUntil ? ` · قفل مؤقت حتى ${new Date(status.lockedUntil).toLocaleString("ar")}` : ""}</p> : null}
    {notice ? <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900" role="status">{notice}</p> : null}
  </section>;
}
