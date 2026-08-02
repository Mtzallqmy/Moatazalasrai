"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Cloud, Loader2, LogIn, LogOut, RefreshCw } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { getPuterClient } from "@/lib/puter/client";
import { clearPuterModelCache, listPuterModels } from "@/lib/puter/models";
import type { ClientAIModel, PuterConnectionState } from "@/lib/puter/types";

export function PuterProviderCard() {
  const [state, setState] = useState<PuterConnectionState>("idle");
  const [models, setModels] = useState<ClientAIModel[]>([]);
  const [error, setError] = useState("");

  async function loadModels(force = false) {
    setState("loading-models");
    setError("");
    try {
      if (force) clearPuterModelCache();
      setModels(await listPuterModels({ force }));
      setState("connected");
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "تعذر تحميل نماذج Puter.");
    }
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setState("loading-sdk");
      void getPuterClient().then(async (client) => {
        if (!active) return;
        if (!client.auth.isSignedIn()) {
          setState("idle");
          return;
        }
        setState("loading-models");
        const available = await listPuterModels();
        if (!active) return;
        setModels(available);
        setState("connected");
      }).catch((cause) => {
        if (!active) return;
        setState("error");
        setError(cause instanceof Error ? cause.message : "تعذر تحميل Puter.");
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  async function connect() {
    setState("connecting");
    setError("");
    try {
      const client = await getPuterClient();
      await client.auth.signIn();
      await loadModels(true);
    } catch {
      setState("error");
      setError("تعذر الاتصال بحساب Puter أو أُغلقت نافذة المصادقة.");
    }
  }

  async function disconnect() {
    try {
      const client = await getPuterClient();
      client.auth.signOut();
      clearPuterModelCache();
      setModels([]);
      setState("idle");
      setError("");
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "تعذر قطع الاتصال بـPuter.");
    }
  }

  const connected = state === "connected" || state === "loading-models";
  const busy = state === "loading-sdk" || state === "connecting" || state === "loading-models";

  return <Card className="mb-5 p-5 sm:p-6" aria-label="مزوّد Puter">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-2xl bg-[var(--primary-soft)] p-3 text-[var(--primary-strong)]"><Cloud size={22} /></span>
          <div><h2 className="text-lg font-extrabold">Puter</h2><p className="text-xs text-[var(--text-secondary)]">مزوّد اختياري مُدار من حساب المستخدم</p></div>
          <Badge tone="neutral">يعمل من المتصفح</Badge>
          {connected ? <Badge tone="success">متصل</Badge> : null}
        </div>
        <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">استخدم نماذج الذكاء الاصطناعي عبر حساب Puter الخاص بك دون إضافة مفتاح API إلى المنصة.</p>
        <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">يُحتسب الاستخدام على حساب المستخدم في Puter وفق سياسة Puter. لا يُخزن خادم معتز رمز مصادقة Puter أو بيانات اعتماده.</p>
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-xs leading-6 text-[var(--text-secondary)]">
          يدعم في هذا الإصدار الدردشة النصية المباشرة واكتشاف النماذج. لا يدعم Worker أو Telegram أو API v1 أو فرق الوكلاء أو أدوات الخادم.
        </div>
      </div>
      <div className="flex min-w-56 flex-col gap-2">
        {!connected ? <Button disabled={busy} onClick={() => void connect()} aria-label="الاتصال بحساب Puter">
          {busy ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />} الاتصال بـPuter
        </Button> : <>
          <Button variant="secondary" disabled={busy} onClick={() => void loadModels(true)} aria-label="إعادة تحميل نماذج Puter">
            {state === "loading-models" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} إعادة تحميل النماذج
          </Button>
          <Button variant="ghost" onClick={() => void disconnect()} aria-label="قطع الاتصال بحساب Puter"><LogOut size={16} /> قطع الاتصال</Button>
        </>}
      </div>
    </div>
    {error ? <p className="mt-4 rounded-xl border border-red-300/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200" role="alert"><CircleAlert className="me-2 inline" size={17} />{error}</p> : null}
    {connected ? <div className="mt-5 border-t border-[var(--border)] pt-4">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold">النماذج المتاحة</h3><span className="text-xs text-[var(--text-secondary)]">{models.length} نموذجًا من Puter</span></div>
      <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto">{models.slice(0, 40).map((model) => <span key={model.id} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs" title={model.id}>{model.name}</span>)}</div>
    </div> : null}
  </Card>;
}
