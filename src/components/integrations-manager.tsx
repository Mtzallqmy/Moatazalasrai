"use client";

import { FormEvent, useState } from "react";

type Agent = { id: string; name: string };
type Integration = {
  id: string;
  kind: "telegram" | "github";
  name: string;
  tokenHint: string;
  config: { botUsername?: string; login?: string; agentId?: string; webhookActive?: boolean };
  status: "pending" | "verified" | "failed";
  enabled: boolean;
  lastVerifiedAt?: string | null;
};
type Api<T> = { success?: boolean; data?: T; error?: { message?: string } };

export function IntegrationsManager({ agents, initialItems }: { agents: Agent[]; initialItems: Integration[] }) {
  const [items, setItems] = useState<Integration[]>(initialItems);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/dashboard/integrations");
    const payload = await response.json().catch(() => null) as Api<Integration[]> | null;
    if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تحميل التكاملات.");
    setItems(payload.data ?? []);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get("kind")) as "telegram" | "github";
    try {
      const response = await fetch("/api/dashboard/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          name: data.get("name"),
          token: data.get("token"),
          ...(kind === "telegram" && data.get("agentId") ? { agentId: data.get("agentId") } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as Api<Integration> | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر إنشاء التكامل.");
      form.reset();
      setMessage(kind === "telegram" ? "تم التحقق من البوت وتفعيل Webhook." : "تم التحقق من GitHub وحفظ التوكن مشفرًا.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء التكامل.");
    } finally {
      setBusy(false);
    }
  }

  async function mutate(method: "PATCH" | "DELETE", body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/integrations", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as Api<unknown> | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تحديث التكامل.");
      setMessage("تم تحديث التكامل.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث التكامل.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <form onSubmit={create} className="soft-card grid gap-4 p-5">
        <div>
          <h2 className="font-bold">إضافة تكامل</h2>
          <p className="mt-2 text-sm leading-7 text-stone-400">يُتحقق من التوكن قبل حفظه، ثم يُشفّر داخل قاعدة البيانات ولا يظهر مجددًا.</p>
        </div>
        <label className="grid gap-2 text-sm">النوع
          <select name="kind" className="form-control" defaultValue="telegram">
            <option value="telegram">Telegram Bot</option>
            <option value="github">GitHub Token</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">الاسم
          <input name="name" required minLength={2} maxLength={80} className="form-control" placeholder="بوت المؤسسة أو GitHub الرئيسي" />
        </label>
        <label className="grid gap-2 text-sm">التوكن
          <input name="token" type="password" required minLength={8} autoComplete="off" className="form-control font-latin" dir="ltr" />
        </label>
        <label className="grid gap-2 text-sm">الوكيل الافتراضي لـTelegram
          <select name="agentId" className="form-control" defaultValue="">
            <option value="">يُحدد لاحقًا</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <button disabled={busy} className="primary-button disabled:opacity-50">تحقق واحفظ</button>
      </form>

      <section className="space-y-4">
        {message ? <p role="status" className="soft-card p-4 text-sm">{message}</p> : null}
        {items.map((item) => (
          <article key={item.id} className="soft-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-stone-500">{item.kind}</p>
                <h3 className="mt-1 font-bold">{item.name}</h3>
                <p className="mt-2 font-latin text-xs text-stone-500" dir="ltr">{item.tokenHint}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs ${item.status === "verified" && item.enabled ? "bg-emerald-100/15 text-emerald-100" : "bg-amber-100/10 text-amber-100"}`}>
                {item.status === "verified" && item.enabled ? "متصل" : "يحتاج انتباهًا"}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-stone-400">
              {item.kind === "telegram" ? <p>البوت: @{item.config.botUsername ?? "غير معروف"} — Webhook: {item.config.webhookActive ? "فعّال" : "غير فعّال"}</p> : null}
              {item.kind === "github" ? <p>الحساب: {item.config.login ?? "غير معروف"}</p> : null}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {item.kind === "telegram" ? (
                <button disabled={busy} onClick={() => mutate("PATCH", { id: item.id, activateWebhook: true })} className="secondary-button">إعادة تفعيل Webhook</button>
              ) : null}
              <button disabled={busy} onClick={() => mutate("PATCH", { id: item.id, enabled: !item.enabled })} className="secondary-button">{item.enabled ? "تعطيل" : "تفعيل"}</button>
              <button disabled={busy} onClick={() => window.confirm("حذف التكامل؟") && mutate("DELETE", { id: item.id })} className="danger-button">حذف</button>
            </div>
          </article>
        ))}
        {items.length === 0 ? <div className="soft-card p-10 text-center text-sm text-stone-500">لا توجد تكاملات بعد.</div> : null}
      </section>
    </div>
  );
}
