"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type MfaStatus = {
  required: boolean;
  enabled: boolean;
  pendingEnrollment: boolean;
  verifiedAt: string | null;
  sessionVerifiedAt: string | null;
  unusedRecoveryCodes: number;
};

type Enrollment = {
  secret: string;
  otpauthUri: string;
  algorithm: "SHA1";
  digits: 6;
  period: 30;
};

type Api<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string; requestId?: string };
};

function errorMessage(payload: Api<unknown> | null, fallback: string) {
  const requestId = payload?.error?.requestId ? ` (${payload.error.requestId})` : "";
  return `${payload?.error?.message ?? fallback}${requestId}`;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as Api<T> | null;
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new Error(errorMessage(payload, "تعذر إكمال عملية التحقق الثنائي."));
  }
  return payload.data;
}

export function MfaSecurityCard({ visible }: { visible: boolean }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const next = await apiRequest<MfaStatus>("/api/auth/mfa/status");
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      void loadStatus().catch((error) => {
        setMessage(error instanceof Error ? error.message : "تعذر تحميل حالة التحقق الثنائي.");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [loadStatus, visible]);

  if (!visible) return null;

  async function beginEnrollment() {
    setBusy("enroll");
    setMessage(null);
    setRecoveryCodes([]);
    try {
      const next = await apiRequest<Enrollment>("/api/auth/mfa/enroll", { method: "POST" });
      setEnrollment(next);
      setMessage("أضف السر إلى تطبيق المصادقة، ثم أدخل أول رمز لإكمال التسجيل.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر بدء تسجيل التحقق الثنائي.");
    } finally {
      setBusy(null);
    }
  }

  async function completeEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "");
    setBusy("complete");
    setMessage(null);
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>("/api/auth/mfa/enroll", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      form.reset();
      await loadStatus();
      setMessage("تم تفعيل التحقق الثنائي. احفظ رموز الاسترداد الآن؛ لن تظهر مرة أخرى.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إكمال التسجيل.");
    } finally {
      setBusy(null);
    }
  }

  async function verifySession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "");
    setBusy("verify");
    setMessage(null);
    try {
      await apiRequest<{ verified: true; method: "totp" | "recovery" }>("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      form.reset();
      await loadStatus();
      setMessage("تم توثيق هذه الجلسة للعمليات الحساسة.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر توثيق الجلسة.");
    } finally {
      setBusy(null);
    }
  }

  const sessionFresh = Boolean(status?.sessionVerifiedAt);

  return (
    <section className="soft-card grid gap-4 p-5 lg:col-span-2" aria-labelledby="mfa-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="mfa-heading" className="font-bold">التحقق الثنائي للعمليات الحساسة</h2>
          <p className="mt-2 text-sm leading-7 text-stone-400">
            يلزم TOTP للمالكين والمديرين قبل إدارة الأعضاء والمزودات والتكاملات أو تشغيل الوكلاء والأدوات الحساسة.
          </p>
        </div>
        <span className="rounded-full border border-stone-700 px-3 py-1 text-xs">
          {!status ? "جارٍ التحقق…" : status.enabled ? "مفعّل" : "غير مفعّل"}
        </span>
      </div>

      {message ? <p role="status" className="rounded-xl border border-stone-700 p-3 text-sm">{message}</p> : null}

      {status?.enabled ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-stone-800 p-4 text-sm leading-7">
            <p>العامل مفعّل منذ: {status.verifiedAt ? new Date(status.verifiedAt).toLocaleString("ar") : "—"}</p>
            <p>رموز الاسترداد المتبقية: {status.unusedRecoveryCodes}</p>
            <p>حالة الجلسة: {sessionFresh ? "موثقة" : "تحتاج رمزًا جديدًا"}</p>
          </div>
          <form onSubmit={verifySession} className="grid gap-3 rounded-2xl border border-stone-800 p-4">
            <label className="grid gap-2 text-sm">
              رمز TOTP أو رمز استرداد
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={64} className="form-control" />
            </label>
            <button disabled={busy !== null} className="primary-button">
              {busy === "verify" ? "جارٍ التحقق…" : "توثيق هذه الجلسة"}
            </button>
          </form>
          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-900/60 p-4 text-sm">
            <p>استبدال العامل يبطل السر ورموز الاسترداد الحالية، ويتطلب جلسة موثقة أولًا.</p>
            <button type="button" disabled={busy !== null || !sessionFresh} onClick={() => void beginEnrollment()} className="secondary-button">
              استبدال عامل TOTP
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {!enrollment ? (
            <button type="button" disabled={busy !== null} onClick={() => void beginEnrollment()} className="primary-button justify-self-start">
              {busy === "enroll" ? "جارٍ الإنشاء…" : "بدء إعداد TOTP"}
            </button>
          ) : (
            <div className="grid gap-4 rounded-2xl border border-stone-800 p-4">
              <p className="text-sm">أضف الحساب يدويًا إلى تطبيق المصادقة بهذه البيانات:</p>
              <dl className="grid gap-2 text-sm">
                <div><dt className="text-stone-400">السر</dt><dd dir="ltr" className="mt-1 break-all rounded-lg bg-stone-950 p-3 font-mono">{enrollment.secret}</dd></div>
                <div><dt className="text-stone-400">الخوارزمية</dt><dd>{enrollment.algorithm} · {enrollment.digits} أرقام · كل {enrollment.period} ثانية</dd></div>
              </dl>
              <a href={enrollment.otpauthUri} className="secondary-button justify-self-start">فتح تطبيق المصادقة</a>
              <form onSubmit={completeEnrollment} className="grid gap-3 md:max-w-md">
                <label className="grid gap-2 text-sm">
                  أول رمز من التطبيق
                  <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required minLength={6} maxLength={6} className="form-control" />
                </label>
                <button disabled={busy !== null} className="primary-button">
                  {busy === "complete" ? "جارٍ التفعيل…" : "تفعيل وإنشاء رموز الاسترداد"}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {recoveryCodes.length > 0 ? (
        <div className="rounded-2xl border border-emerald-900/70 p-4">
          <h3 className="font-bold">رموز الاسترداد — تظهر مرة واحدة</h3>
          <p className="mt-2 text-sm text-stone-400">احفظها في مدير كلمات مرور. كل رمز صالح لاستخدام واحد.</p>
          <div dir="ltr" className="mt-4 grid gap-2 font-mono text-sm sm:grid-cols-2">
            {recoveryCodes.map((code) => <code key={code} className="rounded-lg bg-stone-950 p-2">{code}</code>)}
          </div>
        </div>
      ) : null}
    </section>
  );
}
