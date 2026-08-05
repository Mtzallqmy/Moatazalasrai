"use client";

import { useState } from "react";

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

export function CentralTelegramManager(props: {
  initialStatus: LinkStatus;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [selectedUserId, setSelectedUserId] = useState(props.currentUserId);
  const [adminStatus, setAdminStatus] = useState<LinkStatus>(props.initialStatus);
  const [code, setCode] = useState<{ value: string; deepLink: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshOwn() {
    const response = await fetch("/api/telegram/link-status", { cache: "no-store" });
    const payload = await response.json() as Api<LinkStatus>;
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر تحميل حالة الربط.");
    setStatus(payload.data);
    if (selectedUserId === props.currentUserId) setAdminStatus(payload.data);
  }

  async function createCode() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/telegram/link-code", { method: "POST" });
      const payload = await response.json() as Api<{ code: string; deepLink: string; expiresAt: string }>;
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر إنشاء رمز الربط.");
      setCode({ value: payload.data.code, deepLink: payload.data.deepLink, expiresAt: payload.data.expiresAt });
      setMessage("أرسل الرمز إلى البوت أو افتح الرابط. لن يظهر الرمز مجددًا بعد مغادرة الصفحة.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر إنشاء رمز الربط."); }
    finally { setBusy(false); }
  }

  async function unlink() {
    if (!window.confirm("فصل حساب Telegram؟")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/telegram/link", { method: "DELETE" });
      const payload = await response.json() as Api<unknown>;
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر فصل الحساب.");
      setCode(null);
      await refreshOwn();
      setMessage("تم فصل حساب Telegram.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر فصل الحساب."); }
    finally { setBusy(false); }
  }

  async function loadUser(userId: string) {
    setSelectedUserId(userId); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/dashboard/integrations/telegram-permissions?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      const payload = await response.json() as Api<LinkStatus>;
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? "تعذر تحميل صلاحيات المستخدم.");
      setAdminStatus(payload.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تحميل صلاحيات المستخدم."); }
    finally { setBusy(false); }
  }

  async function toggleFeature(featureKey: string, enabled: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/dashboard/integrations/telegram-permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, featureKey, enabled, limits: {} }),
      });
      const payload = await response.json() as Api<unknown>;
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر تحديث الصلاحية.");
      await loadUser(selectedUserId);
      setMessage("تم تحديث صلاحية Telegram وتطبق على الرسالة التالية.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تحديث الصلاحية."); }
    finally { setBusy(false); }
  }

  const enabledFeatures = new Set(adminStatus.permissions.filter((item) => item.enabled).map((item) => item.featureKey));
  const displayName = [status.link?.firstName, status.link?.lastName].filter(Boolean).join(" ") || status.link?.username || "حساب Telegram";

  return (
    <section className="soft-card space-y-5 p-5">
      <div>
        <h2 className="font-bold">ربط تيليجرام</h2>
        <p className="mt-2 text-sm leading-7 text-stone-400">تستخدم المنصة بوتًا مركزيًا واحدًا. لا تُخزن أي Bot Token داخل المؤسسة.</p>
      </div>
      <div className="rounded-2xl border border-white/10 p-4 text-sm">
        <p>الحالة: <strong>{status.linked ? "مرتبط" : "غير مرتبط"}</strong></p>
        {status.linked ? (
          <div className="mt-2 space-y-1 text-stone-400">
            <p>{displayName}{status.link?.username ? ` — @${status.link.username}` : ""}</p>
            <p>تاريخ الربط: {status.link?.linkedAt ? new Date(status.link.linkedAt).toLocaleString("ar") : "—"}</p>
            <p>آخر نشاط: {status.link?.lastSeenAt ? new Date(status.link.lastSeenAt).toLocaleString("ar") : "—"}</p>
          </div>
        ) : null}
      </div>
      {code ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-4">
          <p className="text-sm">رمز الربط المؤقت</p>
          <p className="mt-2 font-latin text-3xl font-bold tracking-[0.35em]" dir="ltr">{code.value}</p>
          <p className="mt-2 text-xs text-stone-400">ينتهي: {new Date(code.expiresAt).toLocaleString("ar")}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className="primary-button" disabled={busy} onClick={() => void createCode()}>إنشاء رمز ربط</button>
        {(code?.deepLink || status.botUsername) ? (
          <a className="secondary-button" target="_blank" rel="noreferrer" href={code?.deepLink ?? `https://t.me/${status.botUsername}`}>فتح البوت</a>
        ) : null}
        {status.linked ? <button className="danger-button" disabled={busy} onClick={() => void unlink()}>فصل الحساب</button> : null}
      </div>

      {props.canManage ? (
        <div className="space-y-4 border-t border-white/10 pt-5">
          <h3 className="font-semibold">صلاحيات المستخدمين</h3>
          <label className="grid gap-2 text-sm">المستخدم
            <select className="form-control" value={selectedUserId} disabled={busy} onChange={(event) => void loadUser(event.target.value)}>
              {props.members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}
            </select>
          </label>
          <p className="text-xs text-stone-400">السياسة Fail-closed: الميزة غير المسجلة أو غير المفعلة ممنوعة.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {Object.entries(featureLabels).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-xl border border-white/10 p-3 text-sm">
                <input type="checkbox" checked={enabledFeatures.has(key)} disabled={busy}
                  onChange={(event) => void toggleFeature(key, event.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </section>
  );
}
