"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2, Send, ShieldCheck } from "lucide-react";

const featureLabels: Record<string, string> = {
  "telegram.chat": "الدردشة",
  "telegram.agents": "الوكلاء",
  "telegram.files": "الملفات",
  "telegram.images": "الصور",
  "telegram.audio": "الصوت",
  "telegram.video": "الفيديو",
  "telegram.notifications": "الإشعارات",
  "telegram.admin_commands": "الأوامر الإدارية",
};

type LinkStatus = {
  linked: boolean;
  link: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    status: string;
    linkedAt: string | Date;
    lastSeenAt: string | Date;
  } | null;
  permissions: Array<{ featureKey: string; enabled: boolean; limits: Record<string, unknown> }>;
  botUsername: string | null;
};
type Member = { id: string; name: string; email: string };
type Api<T> = { success?: boolean; data?: T; error?: { message?: string } };
type LinkCode = {
  value: string;
  deepLink: string;
  appDeepLink: string;
  botUsername: string;
  expiresAt: string;
};

export function CentralTelegramManager(props: {
  initialStatus: LinkStatus;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [selectedUserId, setSelectedUserId] = useState(props.currentUserId);
  const [adminStatus, setAdminStatus] = useState<LinkStatus>(props.initialStatus);
  const [code, setCode] = useState<LinkCode | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshOwn = useCallback(async () => {
    const response = await fetch("/api/telegram/link-status", { cache: "no-store" });
    const payload = await response.json() as Api<LinkStatus>;
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر تحميل حالة الربط.");
    setStatus(payload.data);
    if (payload.data.linked) {
      setCode(null);
      setMessage("تم ربط حساب Telegram بنجاح.");
    }
    if (selectedUserId === props.currentUserId) setAdminStatus(payload.data);
  }, [props.currentUserId, selectedUserId]);

  useEffect(() => {
    const synchronize = () => {
      if (document.visibilityState === "visible") void refreshOwn().catch(() => undefined);
    };
    window.addEventListener("pageshow", synchronize);
    window.addEventListener("focus", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      window.removeEventListener("pageshow", synchronize);
      window.removeEventListener("focus", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, [refreshOwn]);

  useEffect(() => {
    if (!code || status.linked) return;
    const expiresAt = new Date(code.expiresAt).getTime();
    const timer = window.setInterval(() => {
      if (Date.now() >= expiresAt) {
        window.clearInterval(timer);
        return;
      }
      void refreshOwn().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [code, refreshOwn, status.linked]);

  function openBot(nextCode: LinkCode) {
    const fallbackTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") window.location.href = nextCode.appDeepLink;
    }, 1_400);
    window.addEventListener("pagehide", () => window.clearTimeout(fallbackTimer), { once: true });
    window.location.href = nextCode.deepLink;
  }

  async function createCodeAndOpenBot() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/telegram/link-code", { method: "POST" });
      const payload = await response.json() as Api<{
        code: string;
        deepLink: string;
        appDeepLink: string;
        botUsername: string;
        expiresAt: string;
      }>;
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر إنشاء رمز الربط.");
      const nextCode: LinkCode = {
        value: payload.data.code,
        deepLink: payload.data.deepLink,
        appDeepLink: payload.data.appDeepLink,
        botUsername: payload.data.botUsername,
        expiresAt: payload.data.expiresAt,
      };
      setCode(nextCode);
      setMessage("تم إنشاء الرمز. إذا لم يفتح التطبيق، استخدم زر فتح Telegram أو انسخ الرمز.");
      setBusy(false);
      openBot(nextCode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء رمز الربط.");
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.value);
      setMessage("تم نسخ رمز الربط. أرسله إلى البوت إذا لم يعمل الرابط التلقائي.");
    } catch {
      setMessage(`انسخ رمز الربط يدويًا: ${code.value}`);
    }
  }

  async function unlink() {
    if (!window.confirm("فصل حساب Telegram؟")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/telegram/link", { method: "DELETE" });
      const payload = await response.json() as Api<unknown>;
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر فصل الحساب.");
      setCode(null);
      await refreshOwn();
      setMessage("تم فصل حساب Telegram.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر فصل الحساب.");
    } finally {
      setBusy(false);
    }
  }

  async function loadUser(userId: string) {
    setSelectedUserId(userId);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/dashboard/integrations/telegram-permissions?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      const payload = await response.json() as Api<LinkStatus>;
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر تحميل صلاحيات المستخدم.");
      setAdminStatus(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل صلاحيات المستخدم.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFeature(featureKey: string, enabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/integrations/telegram-permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, featureKey, enabled, limits: {} }),
      });
      const payload = await response.json() as Api<unknown>;
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر تحديث الصلاحية.");
      await loadUser(selectedUserId);
      setMessage("تم تحديث صلاحية Telegram، وسيطبق التغيير على الرسالة التالية.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث الصلاحية.");
    } finally {
      setBusy(false);
    }
  }

  const enabledFeatures = new Set(adminStatus.permissions.filter((item) => item.enabled).map((item) => item.featureKey));
  const displayName = [status.link?.firstName, status.link?.lastName].filter(Boolean).join(" ") || status.link?.username || "حساب Telegram";
  const botLink = code?.deepLink ?? (status.botUsername ? `https://t.me/${status.botUsername}` : null);

  return (
    <section className="soft-card telegram-link-card">
      <div className="telegram-link-card__header">
        <div className="telegram-link-card__identity">
          <span className="telegram-link-card__icon" aria-hidden="true"><Send size={21} /></span>
          <div>
            <h2 className="telegram-link-card__title">ربط Telegram</h2>
            <p className="telegram-link-card__description">
              تستخدم المنصة بوتًا مركزيًا واحدًا. أنشئ رمزًا مؤقتًا وسيتم نقلك مباشرة إلى البوت لإكمال الربط، دون تخزين Bot Token داخل المؤسسة.
            </p>
          </div>
        </div>
        <span className="telegram-status-chip" data-ready={Boolean(status.botUsername)}>
          {status.botUsername ? <CheckCircle2 size={15} /> : <ShieldCheck size={15} />}
          {status.botUsername ? `البوت جاهز — @${status.botUsername}` : "البوت غير مهيأ"}
        </span>
      </div>

      <div className="telegram-account-panel">
        <div>
          <p className="telegram-account-panel__label">حالة الحساب</p>
          <p className="telegram-account-panel__value">{status.linked ? `مرتبط — ${displayName}` : "غير مرتبط"}</p>
          {status.linked && status.link ? (
            <div className="telegram-code-panel__expiry">
              <p>تاريخ الربط: {new Date(status.link.linkedAt).toLocaleString("ar-SA")}</p>
              <p>آخر نشاط: {new Date(status.link.lastSeenAt).toLocaleString("ar-SA")}</p>
            </div>
          ) : null}
        </div>
        {status.linked ? <CheckCircle2 size={24} color="var(--success)" aria-label="الحساب مرتبط" /> : <Link2 size={24} color="var(--text-secondary)" aria-label="الحساب غير مرتبط" />}
      </div>

      {code && !status.linked ? (
        <div className="telegram-code-panel">
          <div className="telegram-code-panel__row">
            <div>
              <p className="telegram-code-panel__label">رمز الربط المؤقت</p>
              <p className="telegram-code-panel__code font-latin" dir="ltr">{code.value}</p>
              <p className="telegram-code-panel__expiry">ينتهي: {new Date(code.expiresAt).toLocaleString("ar-SA")}</p>
            </div>
            <button type="button" className="telegram-icon-button" onClick={() => void copyCode()}>
              <Copy size={16} /> نسخ الرمز
            </button>
          </div>
        </div>
      ) : null}

      <div className="telegram-actions">
        {!status.linked ? (
          <button className="primary-button" disabled={busy || !status.botUsername} onClick={() => void createCodeAndOpenBot()}>
            <Send size={17} /> {busy ? "جارٍ التجهيز…" : "إنشاء رمز وفتح البوت"}
          </button>
        ) : null}
        {botLink ? (
          <a className="secondary-button" href={botLink}>
            <ExternalLink size={17} /> فتح البوت مباشرة
          </a>
        ) : null}
        {code && !status.linked ? (
          <a className="secondary-button" href={code.appDeepLink}>
            <Send size={17} /> فتح تطبيق Telegram
          </a>
        ) : null}
        {status.linked ? <button className="danger-button" disabled={busy} onClick={() => void unlink()}>فصل الحساب</button> : null}
      </div>

      {props.canManage ? (
        <details className="telegram-permissions">
          <summary>
            <span>صلاحيات مستخدمي Telegram</span>
            <ShieldCheck size={17} aria-hidden="true" />
          </summary>
          <div className="telegram-permissions__body">
            <label className="grid gap-2 text-sm">المستخدم
              <select className="form-control" value={selectedUserId} disabled={busy} onChange={(event) => void loadUser(event.target.value)}>
                {props.members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}
              </select>
            </label>
            <p className="telegram-code-panel__expiry">السياسة مغلقة افتراضيًا: أي ميزة غير مفعلة صراحةً تبقى ممنوعة.</p>
            <div className="telegram-feature-grid">
              {Object.entries(featureLabels).map(([key, label]) => (
                <label key={key} className="telegram-feature-option">
                  <input type="checkbox" checked={enabledFeatures.has(key)} disabled={busy}
                    onChange={(event) => void toggleFeature(key, event.target.checked)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </details>
      ) : null}

      {message ? <p role="status" aria-live="polite" className="telegram-message">{message}</p> : null}
    </section>
  );
}
