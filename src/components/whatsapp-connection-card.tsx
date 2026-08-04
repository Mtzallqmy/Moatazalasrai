"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = {
  enabled: boolean;
  configured?: boolean;
  connected: boolean;
  connectedAt: string | null;
  lastInteractionAt?: string | null;
  phoneNumberMasked: string | null;
};

type Api<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string; requestId?: string };
};

function apiMessage(payload: Api<unknown> | null, fallback: string) {
  const requestId = payload?.error?.requestId ? ` (${payload.error.requestId})` : "";
  return `${payload?.error?.message ?? fallback}${requestId}`;
}

export function WhatsAppConnectionCard({ canManagePlatform = false }: { canManagePlatform?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const statusRef = useRef<Status | null>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/integrations/whatsapp/status", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as Api<Status> | null;
    if (!response.ok || !payload?.success || !payload.data) {
      throw new Error(apiMessage(payload, "تعذر تحميل حالة WhatsApp."));
    }
    statusRef.current = payload.data;
    setStatus(payload.data);
    return payload.data;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadStatus().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر تحميل حالة WhatsApp."));
    }, 0);
    return () => clearTimeout(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (!expiresAt || status?.connected) return;
    const expiresMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresMs)) return;
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      if (Date.now() >= expiresMs) {
        setExpiresAt(null);
        setMessage("انتهت صلاحية رابط الربط. أنشئ رابطًا جديدًا.");
        return;
      }
      try {
        const next = await loadStatus();
        if (next.connected) {
          setExpiresAt(null);
          setMessage("تم ربط WhatsApp بنجاح.");
        }
      } catch {
        // يبقى polling محدودًا حتى عودة الاتصال أو انتهاء الرابط.
      }
    };
    const interval = setInterval(() => { void check(); }, 3_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [expiresAt, loadStatus, status?.connected]);

  const expiryLabel = useMemo(() => {
    if (!expiresAt) return null;
    const value = new Date(expiresAt);
    return Number.isNaN(value.getTime()) ? null : value.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  }, [expiresAt]);

  async function connect() {
    setBusy("connect");
    setMessage(null);
    const popup = window.open("about:blank", "whatsapp-connect");
    try {
      const response = await fetch("/api/integrations/whatsapp/connect", { method: "POST" });
      const payload = await response.json().catch(() => null) as Api<{ whatsappUrl: string; expiresAt: string }> | null;
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(apiMessage(payload, "تعذر إنشاء رابط WhatsApp."));
      }
      setExpiresAt(payload.data.expiresAt);
      setMessage("أرسل الرسالة الجاهزة من WhatsApp. فتح الرابط وحده لا يكمل الربط.");
      if (popup) popup.location.replace(payload.data.whatsappUrl);
      else window.location.assign(payload.data.whatsappUrl);
    } catch (error) {
      popup?.close();
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء رابط WhatsApp.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("إلغاء ربط WhatsApp بهذا الحساب؟")) return;
    setBusy("disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/whatsapp/connection", { method: "DELETE" });
      const payload = await response.json().catch(() => null) as Api<{ disconnected: boolean }> | null;
      if (!response.ok || !payload?.success) throw new Error(apiMessage(payload, "تعذر إلغاء الربط."));
      setExpiresAt(null);
      await loadStatus();
      setMessage("تم إلغاء ربط WhatsApp.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إلغاء الربط.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="soft-card mt-5 p-5" aria-labelledby="whatsapp-connection-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="whatsapp-connection-title" className="font-bold">WhatsApp Business</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-400">
            اربط رقم WhatsApp بحسابك عبر رسالة تستخدم مرة واحدة. لا نخزن رمز الربط الخام ولا نعرض رقمك كاملًا.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${status?.connected ? "bg-emerald-100/15 text-emerald-100" : "bg-stone-100/10 text-stone-300"}`}>
          {status === null ? "جارٍ الفحص" : !status.enabled ? status.configured ? "جاهز للتفعيل" : "يحتاج إعداد" : status.connected ? "مرتبط" : "جاهز للربط"}
        </span>
      </div>

      {status?.connected ? (
        <div className="mt-4 grid gap-1 text-sm text-stone-300">
          <p>الرقم: <span dir="ltr" className="font-latin">{status.phoneNumberMasked ?? "••••••"}</span></p>
          <p>تاريخ الربط: {status.connectedAt ? new Date(status.connectedAt).toLocaleString("ar") : "غير متاح"}</p>
        </div>
      ) : null}

      {status && !status.enabled ? (
        <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-200/10 p-4 text-sm leading-7 text-amber-100">
          {canManagePlatform ? (
            <p>يلزم إدخال بيانات Meta الفعلية واجتياز اختبار الاتصال. <Link className="font-bold underline" href="/dashboard/diagnostics#runtime-control">فتح مركز تشغيل المنصة</Link>.</p>
          ) : <p>ميزة WhatsApp لم يفعّلها مدير المنصة بعد. اطلب من المالك أو المدير إكمال إعداد Meta.</p>}
        </div>
      ) : null}

      {expiryLabel ? <p className="mt-4 text-sm text-amber-200">رابط الربط صالح حتى {expiryLabel}.</p> : null}
      {message ? <p role="status" className="mt-4 rounded-2xl border border-stone-700 p-3 text-sm">{message}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {status?.enabled && !status.connected ? (
          <button type="button" disabled={busy !== null} onClick={connect} className="primary-button disabled:opacity-50">
            {busy === "connect" ? "جارٍ إنشاء الرابط..." : expiresAt ? "إنشاء رابط جديد" : "ربط حسابي بواتساب"}
          </button>
        ) : null}
        {status?.enabled && status.connected ? (
          <button type="button" disabled={busy !== null} onClick={disconnect} className="danger-button disabled:opacity-50">
            {busy === "disconnect" ? "جارٍ إلغاء الربط..." : "إلغاء الربط"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
