"use client";

import { FormEvent, useState } from "react";

type Agent = { id: string; name: string };
type Integration = {
  id: string;
  kind: "telegram" | "github";
  name: string;
  tokenHint: string;
  config: { botUsername?: string; login?: string; agentId?: string | null; webhookActive?: boolean; deprecated?: boolean };
  status: "pending" | "verified" | "failed";
  enabled: boolean;
  lastVerifiedAt?: string | null;
};
type Api<T> = { success?: boolean; data?: T; error?: { message?: string; requestId?: string } };

export function IntegrationsManager({ initialItems }: { agents: Agent[]; initialItems: Integration[] }) {
  const [items, setItems] = useState<Integration[]>(initialItems);
  const [busyId, setBusyId] = useState<string | "create" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/dashboard/integrations", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as Api<Integration[]> | null;
    if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تحميل التكاملات.");
    setItems(payload.data ?? []);
  }

  async function createGitHub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("create");
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/dashboard/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "github", name: data.get("name"), token: data.get("token") }),
      });
      const payload = await response.json().catch(() => null) as Api<Integration> | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر إنشاء تكامل GitHub.");
      form.reset();
      setMessage("تم التحقق من GitHub وحفظ التوكن مشفرًا.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء تكامل GitHub.");
    } finally {
      setBusyId(null);
    }
  }

  async function mutate(method: "PATCH" | "DELETE", body: Record<string, unknown>, successMessage: string) {
    const integrationId = typeof body.id === "string" ? body.id : "create";
    setBusyId(integrationId);
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/integrations", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as Api<unknown> | null;
      if (!response.ok || !payload?.success) {
        const requestId = payload?.error?.requestId ? ` (${payload.error.requestId})` : "";
        throw new Error(`${payload?.error?.message ?? "تعذر تحديث التكامل."}${requestId}`);
      }
      setMessage(successMessage);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث التكامل.");
    } finally {
      setBusyId(null);
    }
  }

  const githubItems = items.filter((item) => item.kind === "github");
  const legacyTelegram = items.filter((item) => item.kind === "telegram");

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <form onSubmit={createGitHub} className="soft-card grid gap-4 p-5">
        <div>
          <h2 className="font-bold">إضافة تكامل GitHub</h2>
          <p className="mt-2 text-sm leading-7 text-stone-400">Telegram يستخدم بوت المنصة المركزي ولا يقبل Bot Token من المستخدم.</p>
        </div>
        <label className="grid gap-2 text-sm">الاسم
          <input name="name" required minLength={2} maxLength={80} className="form-control" placeholder="GitHub الرئيسي" />
        </label>
        <label className="grid gap-2 text-sm">GitHub Token
          <input name="token" type="password" required minLength={8} autoComplete="off" className="form-control font-latin" dir="ltr" />
        </label>
        <button disabled={busyId !== null} className="primary-button disabled:opacity-50">{busyId === "create" ? "جارٍ التحقق..." : "تحقق واحفظ"}</button>
      </form>

      <section className="space-y-4">
        {message ? <p role="status" className="soft-card p-4 text-sm">{message}</p> : null}
        {githubItems.map((item) => {
          const busy = busyId === item.id;
          return (
            <article key={item.id} className="soft-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-stone-500">github</p>
                  <h3 className="mt-1 font-bold">{item.name}</h3>
                  <p className="mt-2 font-latin text-xs text-stone-500" dir="ltr">{item.tokenHint}</p>
                  <p className="mt-2 text-sm text-stone-400">الحساب: {item.config.login ?? "غير معروف"}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs ${item.status === "verified" && item.enabled ? "bg-emerald-100/15 text-emerald-100" : "bg-amber-100/10 text-amber-100"}`}>
                  {item.status === "verified" && item.enabled ? "متصل" : "يحتاج انتباهًا"}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => void mutate("PATCH", { id: item.id, enabled: !item.enabled }, "تم تحديث التكامل.")} className="secondary-button">{item.enabled ? "تعطيل" : "تفعيل"}</button>
                <button disabled={busy} onClick={() => window.confirm("حذف التكامل؟") && void mutate("DELETE", { id: item.id }, "تم حذف التكامل.")} className="danger-button">حذف</button>
              </div>
            </article>
          );
        })}
        {legacyTelegram.length ? (
          <div className="soft-card p-5">
            <h3 className="font-semibold">تكاملات Telegram القديمة</h3>
            <p className="mt-2 text-sm leading-7 text-stone-400">محفوظة للتاريخ ولا تستخدم في Webhook المركزي، ولا يمكن تعديل توكناتها أو حذفها من الواجهة أثناء الانتقال.</p>
            <ul className="mt-3 space-y-2 text-sm text-stone-400">
              {legacyTelegram.map((item) => <li key={item.id}>{item.name} — @{item.config.botUsername ?? "غير معروف"}</li>)}
            </ul>
          </div>
        ) : null}
        {githubItems.length === 0 && legacyTelegram.length === 0 ? <div className="soft-card p-10 text-center text-sm text-stone-500">لا توجد تكاملات GitHub بعد.</div> : null}
      </section>
    </div>
  );
}
