"use client";

import { FormEvent, useState } from "react";

type Agent = { id: string; name: string };
type Integration = {
  id: string;
  kind: "telegram" | "github";
  name: string;
  tokenHint: string;
  config: {
    botUsername?: string | null;
    botName?: string | null;
    login?: string;
    agentId?: string | null;
    webhookActive?: boolean;
    webhookPendingUpdates?: number | null;
    webhookLastVerifiedAt?: string | null;
  };
  status: "pending" | "verified" | "failed";
  enabled: boolean;
  lastVerifiedAt?: string | null;
  lastErrorCode?: string | null;
};
type Api<T> = { success?: boolean; data?: T; error?: { message?: string; requestId?: string } };

export function IntegrationsManager({ agents, initialItems }: { agents: Agent[]; initialItems: Integration[] }) {
  const [items, setItems] = useState<Integration[]>(initialItems);
  const [kind, setKind] = useState<"telegram" | "github">("telegram");
  const [busyId, setBusyId] = useState<string | "create" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/dashboard/integrations", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as Api<Integration[]> | null;
    if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تحميل التكاملات.");
    setItems(payload.data ?? []);
  }

  async function createIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("create");
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const agentId = kind === "telegram" ? String(data.get("agentId") ?? "") : "";
    try {
      const response = await fetch("/api/dashboard/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          name: data.get("name"),
          token: data.get("token"),
          ...(agentId ? { agentId } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as Api<Integration> | null;
      if (!response.ok || !payload?.success) {
        const requestId = payload?.error?.requestId ? ` (${payload.error.requestId})` : "";
        throw new Error(`${payload?.error?.message ?? "تعذر إنشاء التكامل."}${requestId}`);
      }
      form.reset();
      setMessage(kind === "telegram"
        ? "تم التحقق من Bot Token وتسجيل Webhook وربط البوت بالوكيل. يمكن مراسلة البوت الآن دون ربط حسابك بالبوت المركزي."
        : "تم التحقق من GitHub وحفظ التوكن مشفرًا.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء التكامل.");
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

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <form onSubmit={createIntegration} className="soft-card grid gap-4 p-5">
        <div>
          <h2 className="font-bold">إضافة قناة أو تكامل</h2>
          <p className="mt-2 text-sm leading-7 text-stone-400">
            Telegram يدعم خيارين: البوت المركزي لربط حسابك، أو Bot Token خاص بالمؤسسة يعمل مباشرة عبر Webhook المنصة دون أي ربط بالحساب المركزي.
          </p>
        </div>
        <label className="grid gap-2 text-sm">النوع
          <select className="form-control" value={kind} onChange={(event) => setKind(event.target.value as "telegram" | "github") }>
            <option value="telegram">Telegram Bot مستقل</option>
            <option value="github">GitHub</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">الاسم
          <input name="name" required minLength={2} maxLength={80} className="form-control" placeholder={kind === "telegram" ? "بوت خدمة العملاء" : "GitHub الرئيسي"} />
        </label>
        <label className="grid gap-2 text-sm">{kind === "telegram" ? "Telegram Bot Token" : "GitHub Token"}
          <input name="token" type="password" required minLength={8} autoComplete="off" className="form-control font-latin" dir="ltr" />
        </label>
        {kind === "telegram" ? (
          <label className="grid gap-2 text-sm">الوكيل الافتراضي
            <select name="agentId" required className="form-control" defaultValue="">
              <option value="" disabled>اختر وكيلًا منشورًا</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
        ) : null}
        <button disabled={busyId !== null} className="primary-button disabled:opacity-50">
          {busyId === "create" ? "جارٍ التحقق والتفعيل..." : kind === "telegram" ? "تحقق، سجّل Webhook، وابدأ" : "تحقق واحفظ"}
        </button>
      </form>

      <section className="space-y-4">
        {message ? <p role="status" aria-live="polite" className="soft-card p-4 text-sm">{message}</p> : null}
        {items.map((item) => {
          const busy = busyId === item.id;
          const healthy = item.status === "verified" && item.enabled && (item.kind !== "telegram" || item.config.webhookActive === true);
          return (
            <article key={item.id} className="soft-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-stone-500">{item.kind}</p>
                  <h3 className="mt-1 font-bold">{item.name}</h3>
                  <p className="mt-2 font-latin text-xs text-stone-500" dir="ltr">{item.tokenHint}</p>
                  {item.kind === "telegram" ? (
                    <div className="mt-2 space-y-1 text-sm text-stone-400">
                      <p>البوت: {item.config.botUsername ? `@${item.config.botUsername}` : item.config.botName ?? "غير معروف"}</p>
                      <p>Webhook: {item.config.webhookActive ? "مسجل ومتحقق" : "غير نشط"}</p>
                      {typeof item.config.webhookPendingUpdates === "number" ? <p>رسائل Telegram المعلقة: {item.config.webhookPendingUpdates}</p> : null}
                      <p>المسار: مباشر إلى الوكيل المرتبط — لا يحتاج ربط الحساب المركزي.</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-stone-400">الحساب: {item.config.login ?? "غير معروف"}</p>
                  )}
                  {item.lastErrorCode ? <p className="mt-2 text-xs text-rose-300">{item.lastErrorCode}</p> : null}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs ${healthy ? "bg-emerald-100/15 text-emerald-100" : "bg-amber-100/10 text-amber-100"}`}>
                  {healthy ? "جاهز" : item.enabled ? "يحتاج انتباهًا" : "معطل"}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => void mutate("PATCH", { id: item.id, enabled: !item.enabled }, "تم تحديث حالة التكامل.")} className="secondary-button">
                  {item.enabled ? "تعطيل" : "تفعيل"}
                </button>
                {item.kind === "telegram" ? (
                  <button disabled={busy} onClick={() => void mutate("PATCH", { id: item.id, activateWebhook: true }, "تمت إعادة تسجيل Webhook والتحقق منه لدى Telegram.")} className="secondary-button">
                    فحص وإصلاح Webhook
                  </button>
                ) : null}
                <button disabled={busy} onClick={() => window.confirm("حذف التكامل؟") && void mutate("DELETE", { id: item.id }, "تم حذف التكامل.")} className="danger-button">حذف</button>
              </div>
            </article>
          );
        })}
        {items.length === 0 ? <div className="soft-card p-10 text-center text-sm text-stone-500">لا توجد قنوات أو تكاملات مضافة بعد.</div> : null}
      </section>
    </div>
  );
}
