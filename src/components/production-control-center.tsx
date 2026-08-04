"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { Badge, Button, Card, Input } from "@/components/ui";

type FeatureName = "whatsapp" | "sandbox" | "browser";
type Snapshot = {
  checkedAt: string;
  whatsapp: {
    managed: boolean; source: "database" | "environment"; enabled: boolean; configured: boolean;
    displayPhoneNumber: string | null; appId: string | null; phoneNumberId: string | null;
    businessAccountId: string | null; graphApiVersion: string; publicAppUrl: string | null;
    appSecretHint: string | null; accessTokenHint: string | null; webhookVerifyTokenHint: string | null;
    connectTokenSecretHint: string | null; connectTtlMinutes: number;
  };
  sandbox: {
    managed: boolean; source: "database" | "environment"; enabled: boolean; configured: boolean;
    runnerUrl: string | null; sharedSecretHint: string | null; executionTimeoutMs: number;
    maxOutputBytes: number; maxFileBytes: number; workspaceDiskBytes: number; maxConcurrentPerOrganization: number;
  };
  browser: {
    managed: boolean; source: "database" | "environment"; enabled: boolean; configured: boolean;
    runnerUrl: string | null; sharedSecretHint: string | null; interactiveLoginEnabled: boolean;
    screenshotsEnabled: boolean; taskTimeoutMs: number; maxSteps: number; maxPages: number;
    allowedDownloadBytes: number;
  };
  worker: { active: boolean; lastSeenAt: string | null; workerId: string | null };
  lastHealth: Record<string, unknown>;
};
type Envelope<T> = { success: true; data: T } | { success: false; error: { message: string; requestId?: string } };
type Health = { status: string; checkedAt: string; latencyMs: number; details: string };

function mb(bytes: number) { return Math.max(1, Math.round(bytes / 1_048_576)); }
function minutes(ms: number) { return Math.max(1, Math.round(ms / 60_000)); }
function apiError(payload: Envelope<unknown> | null, fallback: string) {
  if (!payload || payload.success) return fallback;
  return `${payload.error.message}${payload.error.requestId ? ` (${payload.error.requestId})` : ""}`;
}

function FeatureState({ enabled, configured, source }: { enabled: boolean; configured: boolean; source: string }) {
  const tone = enabled && configured ? "success" : configured ? "warning" : "danger";
  const label = enabled && configured ? "مفعّل" : configured ? "جاهز لكنه متوقف" : "يحتاج إعداد";
  return <div className="flex flex-wrap items-center gap-2"><Badge tone={tone}>{label}</Badge><span className="text-xs text-[var(--muted)]">المصدر: {source === "database" ? "لوحة الأدمن" : "بيئة النشر"}</span></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string | null; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-semibold"><span>{label}</span>{children}{hint ? <small className="font-normal text-[var(--muted)]">القيمة الحالية: <bdi dir="ltr">{hint}</bdi></small> : null}</label>;
}

export function ProductionControlCenter() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<FeatureName | "refresh" | null>(null);
  const [message, setMessage] = useState("");
  const [health, setHealth] = useState<Partial<Record<FeatureName, Health>>>({});

  const [wa, setWa] = useState({
    enabled: false, appId: "", appSecret: "", graphApiVersion: "v23.0", accessToken: "",
    phoneNumberId: "", businessAccountId: "", displayPhoneNumber: "", webhookVerifyToken: "",
    connectTokenSecret: "", publicAppUrl: "", connectTtlMinutes: 10,
  });
  const [sandbox, setSandbox] = useState({
    enabled: false, runnerUrl: "", sharedSecret: "", executionTimeoutMinutes: 5,
    maxOutputMb: 2, maxFileMb: 10, workspaceDiskMb: 512, maxConcurrentPerOrganization: 2,
  });
  const [browser, setBrowser] = useState({
    enabled: false, runnerUrl: "", sharedSecret: "", interactiveLoginEnabled: false,
    screenshotsEnabled: true, taskTimeoutMinutes: 5, maxSteps: 50, maxPages: 5, allowedDownloadMb: 10,
  });

  const applySnapshot = useCallback((next: Snapshot) => {
    setSnapshot(next);
    setWa((current) => ({
      ...current,
      enabled: next.whatsapp.enabled,
      appId: next.whatsapp.appId ?? "",
      graphApiVersion: next.whatsapp.graphApiVersion,
      phoneNumberId: next.whatsapp.phoneNumberId ?? "",
      businessAccountId: next.whatsapp.businessAccountId ?? "",
      displayPhoneNumber: next.whatsapp.displayPhoneNumber ?? "",
      publicAppUrl: next.whatsapp.publicAppUrl ?? "",
      connectTtlMinutes: next.whatsapp.connectTtlMinutes,
      appSecret: "", accessToken: "", webhookVerifyToken: "", connectTokenSecret: "",
    }));
    setSandbox({
      enabled: next.sandbox.enabled,
      runnerUrl: next.sandbox.runnerUrl ?? "",
      sharedSecret: "",
      executionTimeoutMinutes: minutes(next.sandbox.executionTimeoutMs),
      maxOutputMb: mb(next.sandbox.maxOutputBytes),
      maxFileMb: mb(next.sandbox.maxFileBytes),
      workspaceDiskMb: mb(next.sandbox.workspaceDiskBytes),
      maxConcurrentPerOrganization: next.sandbox.maxConcurrentPerOrganization,
    });
    setBrowser({
      enabled: next.browser.enabled,
      runnerUrl: next.browser.runnerUrl ?? "",
      sharedSecret: "",
      interactiveLoginEnabled: next.browser.interactiveLoginEnabled,
      screenshotsEnabled: next.browser.screenshotsEnabled,
      taskTimeoutMinutes: minutes(next.browser.taskTimeoutMs),
      maxSteps: next.browser.maxSteps,
      maxPages: next.browser.maxPages,
      allowedDownloadMb: mb(next.browser.allowedDownloadBytes),
    });
  }, []);

  const load = useCallback(async () => {
    setBusy("refresh"); setMessage("");
    try {
      const response = await fetch("/api/dashboard/runtime-control", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as Envelope<Snapshot> | null;
      if (!response.ok || !payload?.success) throw new Error(apiError(payload, "تعذر تحميل مركز التشغيل."));
      applySnapshot(payload.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تحميل مركز التشغيل."); }
    finally { setLoading(false); setBusy(null); }
  }, [applySnapshot]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function save(feature: FeatureName) {
    setBusy(feature); setMessage("");
    const body = feature === "whatsapp" ? {
      feature,
      enabled: wa.enabled,
      connectTtlMinutes: wa.connectTtlMinutes,
      config: {
        appId: wa.appId || undefined,
        appSecret: wa.appSecret || undefined,
        graphApiVersion: wa.graphApiVersion || undefined,
        accessToken: wa.accessToken || undefined,
        phoneNumberId: wa.phoneNumberId || undefined,
        businessAccountId: wa.businessAccountId || undefined,
        displayPhoneNumber: wa.displayPhoneNumber || undefined,
        webhookVerifyToken: wa.webhookVerifyToken || undefined,
        connectTokenSecret: wa.connectTokenSecret || undefined,
        publicAppUrl: wa.publicAppUrl || undefined,
      },
    } : feature === "sandbox" ? {
      feature,
      enabled: sandbox.enabled,
      runnerUrl: sandbox.runnerUrl || undefined,
      sharedSecret: sandbox.sharedSecret || undefined,
      executionTimeoutMs: sandbox.executionTimeoutMinutes * 60_000,
      maxOutputBytes: sandbox.maxOutputMb * 1_048_576,
      maxFileBytes: sandbox.maxFileMb * 1_048_576,
      workspaceDiskBytes: sandbox.workspaceDiskMb * 1_048_576,
      maxConcurrentPerOrganization: sandbox.maxConcurrentPerOrganization,
    } : {
      feature,
      enabled: browser.enabled,
      runnerUrl: browser.runnerUrl || undefined,
      sharedSecret: browser.sharedSecret || undefined,
      interactiveLoginEnabled: browser.interactiveLoginEnabled,
      screenshotsEnabled: browser.screenshotsEnabled,
      taskTimeoutMs: browser.taskTimeoutMinutes * 60_000,
      maxSteps: browser.maxSteps,
      maxPages: browser.maxPages,
      allowedDownloadBytes: browser.allowedDownloadMb * 1_048_576,
    };
    try {
      const response = await fetch("/api/dashboard/runtime-control", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as Envelope<Snapshot> | null;
      if (!response.ok || !payload?.success) throw new Error(apiError(payload, "تعذر حفظ الإعدادات."));
      applySnapshot(payload.data);
      setMessage(`تم حفظ واختبار ${feature === "whatsapp" ? "WhatsApp" : feature === "sandbox" ? "Sandbox" : "Browser Agent"} بنجاح.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر حفظ الإعدادات."); }
    finally { setBusy(null); }
  }

  async function test(feature: FeatureName) {
    setBusy(feature); setMessage("");
    try {
      const response = await fetch("/api/dashboard/runtime-control", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature }),
      });
      const payload = await response.json().catch(() => null) as Envelope<Health> | null;
      if (!payload?.success) throw new Error(apiError(payload, "تعذر اختبار الخدمة."));
      setHealth((current) => ({ ...current, [feature]: payload.data }));
      setMessage(payload.data.details);
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر اختبار الخدمة."); }
    finally { setBusy(null); }
  }

  const webhookUrl = useMemo(() => wa.publicAppUrl ? `${wa.publicAppUrl.replace(/\/$/, "")}/api/webhooks/whatsapp` : "", [wa.publicAppUrl]);

  if (loading) return <Card className="p-8 text-center"><Loader2 className="mx-auto animate-spin" /><p className="mt-3 text-sm text-[var(--muted)]">جارٍ تحميل إعدادات التشغيل المشفرة...</p></Card>;
  if (!snapshot) return <Card className="p-6"><CircleAlert className="me-2 inline" />{message || "تعذر تحميل مركز التشغيل."}</Card>;

  return <section id="runtime-control" className="space-y-5">
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow">Production Control Plane</p>
          <h2 className="mt-2 text-2xl font-extrabold">مركز تشغيل المنصة الحقيقي</h2>
          <p className="mt-2 max-w-4xl text-sm leading-7 text-[var(--muted)]">الإعدادات الحساسة تُشفّر بـ AES-256-GCM داخل PostgreSQL، ولا تُعاد إلى المتصفح. لا يتم تفعيل أي خدمة خارجية قبل نجاح اختبار الاتصال الفعلي.</p>
        </div>
        <Button variant="secondary" disabled={busy !== null} onClick={() => void load()}><RefreshCw className={busy === "refresh" ? "animate-spin" : ""} size={16} /> تحديث الحالة</Button>
      </div>
      {message ? <div role="status" className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">{message}</div> : null}
    </Card>

    <div className="grid gap-4 lg:grid-cols-4">
      <Card className="p-5"><Activity className={snapshot.worker.active ? "text-emerald-600" : "text-red-600"} /><p className="mt-3 text-sm text-[var(--muted)]">عامل المهام</p><p className="mt-1 font-extrabold">{snapshot.worker.active ? "متصل ويعمل" : "غير متصل"}</p><p className="mt-2 text-xs text-[var(--muted)]">{snapshot.worker.lastSeenAt ? new Date(snapshot.worker.lastSeenAt).toLocaleString("ar") : "لا توجد نبضة حديثة"}</p></Card>
      <Card className="p-5"><MessageCircle /><p className="mt-3 text-sm text-[var(--muted)]">WhatsApp</p><p className="mt-1 font-extrabold">{snapshot.whatsapp.enabled ? "جاهز للربط" : "غير مفعّل"}</p></Card>
      <Card className="p-5"><TerminalSquare /><p className="mt-3 text-sm text-[var(--muted)]">Sandbox</p><p className="mt-1 font-extrabold">{snapshot.sandbox.enabled ? "Runner متصل" : "غير مفعّل"}</p></Card>
      <Card className="p-5"><Bot /><p className="mt-3 text-sm text-[var(--muted)]">Browser Agent</p><p className="mt-1 font-extrabold">{snapshot.browser.enabled ? "Runner متصل" : "غير مفعّل"}</p></Card>
    </div>

    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><MessageCircle size={20} /><h3 className="text-lg font-extrabold">WhatsApp Business Cloud API</h3></div><p className="mt-2 text-sm leading-7 text-[var(--muted)]">بعد الحفظ الناجح يظهر زر الربط لكل مستخدم، وتعمل رسائل CONNECT والـWebhook والتحقق من توقيع Meta.</p></div><FeatureState enabled={snapshot.whatsapp.enabled} configured={snapshot.whatsapp.configured} source={snapshot.whatsapp.source} /></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Meta App ID"><Input dir="ltr" value={wa.appId} onChange={(e) => setWa({ ...wa, appId: e.target.value })} /></Field>
        <Field label="Meta App Secret" hint={snapshot.whatsapp.appSecretHint}><Input dir="ltr" type="password" value={wa.appSecret} onChange={(e) => setWa({ ...wa, appSecret: e.target.value })} placeholder="اتركه فارغًا للاحتفاظ بالقيمة" /></Field>
        <Field label="Graph API Version"><Input dir="ltr" value={wa.graphApiVersion} onChange={(e) => setWa({ ...wa, graphApiVersion: e.target.value })} /></Field>
        <Field label="Permanent Access Token" hint={snapshot.whatsapp.accessTokenHint}><Input dir="ltr" type="password" value={wa.accessToken} onChange={(e) => setWa({ ...wa, accessToken: e.target.value })} placeholder="System User token" /></Field>
        <Field label="Phone Number ID"><Input dir="ltr" value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} /></Field>
        <Field label="Business Account ID"><Input dir="ltr" value={wa.businessAccountId} onChange={(e) => setWa({ ...wa, businessAccountId: e.target.value })} /></Field>
        <Field label="رقم العرض الدولي"><Input dir="ltr" value={wa.displayPhoneNumber} onChange={(e) => setWa({ ...wa, displayPhoneNumber: e.target.value })} placeholder="9677..." /></Field>
        <Field label="Webhook Verify Token" hint={snapshot.whatsapp.webhookVerifyTokenHint}><Input dir="ltr" type="password" value={wa.webhookVerifyToken} onChange={(e) => setWa({ ...wa, webhookVerifyToken: e.target.value })} /></Field>
        <Field label="Connect Token Secret" hint={snapshot.whatsapp.connectTokenSecretHint}><Input dir="ltr" type="password" value={wa.connectTokenSecret} onChange={(e) => setWa({ ...wa, connectTokenSecret: e.target.value })} placeholder="32 حرفًا أو أكثر" /></Field>
        <Field label="الرابط العام للمنصة"><Input dir="ltr" value={wa.publicAppUrl} onChange={(e) => setWa({ ...wa, publicAppUrl: e.target.value })} placeholder="https://example.com" /></Field>
        <Field label="مدة رابط الربط بالدقائق"><Input type="number" min={5} max={60} value={wa.connectTtlMinutes} onChange={(e) => setWa({ ...wa, connectTtlMinutes: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold"><input type="checkbox" checked={wa.enabled} onChange={(e) => setWa({ ...wa, enabled: e.target.checked })} /> تفعيل WhatsApp بعد نجاح الاختبار</label>
      </div>
      {webhookUrl ? <div className="mt-4 rounded-xl bg-[var(--surface-muted)] p-3 text-sm"><b>Webhook URL:</b> <code dir="ltr" className="break-all">{webhookUrl}</code> <ExternalLink className="ms-1 inline" size={14} /></div> : null}
      {health.whatsapp ? <p className="mt-3 text-sm"><CheckCircle2 className="me-2 inline" size={16} />{health.whatsapp.details} — {health.whatsapp.latencyMs}ms</p> : null}
      <div className="mt-5 flex flex-wrap gap-2"><Button disabled={busy !== null} onClick={() => void save("whatsapp")}><Save size={16} /> حفظ واختبار وتطبيق</Button><Button variant="secondary" disabled={busy !== null || !snapshot.whatsapp.configured} onClick={() => void test("whatsapp")}><ShieldCheck size={16} /> اختبار الحالي</Button></div>
    </Card>

    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><TerminalSquare size={20} /><h3 className="text-lg font-extrabold">Sandbox Runner</h3></div><p className="mt-2 text-sm leading-7 text-[var(--muted)]">تشغيل أوامر وملفات داخل خدمة Docker معزولة، وليس داخل خادم Next.js.</p></div><FeatureState enabled={snapshot.sandbox.enabled} configured={snapshot.sandbox.configured} source={snapshot.sandbox.source} /></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Runner URL"><Input dir="ltr" value={sandbox.runnerUrl} onChange={(e) => setSandbox({ ...sandbox, runnerUrl: e.target.value })} /></Field>
          <Field label="Shared Secret" hint={snapshot.sandbox.sharedSecretHint}><Input dir="ltr" type="password" value={sandbox.sharedSecret} onChange={(e) => setSandbox({ ...sandbox, sharedSecret: e.target.value })} /></Field>
          <Field label="مهلة التنفيذ بالدقائق"><Input type="number" min={1} max={30} value={sandbox.executionTimeoutMinutes} onChange={(e) => setSandbox({ ...sandbox, executionTimeoutMinutes: Number(e.target.value) })} /></Field>
          <Field label="أقصى مخرجات MB"><Input type="number" min={1} max={20} value={sandbox.maxOutputMb} onChange={(e) => setSandbox({ ...sandbox, maxOutputMb: Number(e.target.value) })} /></Field>
          <Field label="أقصى ملف MB"><Input type="number" min={1} max={100} value={sandbox.maxFileMb} onChange={(e) => setSandbox({ ...sandbox, maxFileMb: Number(e.target.value) })} /></Field>
          <Field label="قرص مساحة العمل MB"><Input type="number" min={10} max={10240} value={sandbox.workspaceDiskMb} onChange={(e) => setSandbox({ ...sandbox, workspaceDiskMb: Number(e.target.value) })} /></Field>
          <Field label="التزامن لكل مؤسسة"><Input type="number" min={1} max={20} value={sandbox.maxConcurrentPerOrganization} onChange={(e) => setSandbox({ ...sandbox, maxConcurrentPerOrganization: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold"><input type="checkbox" checked={sandbox.enabled} onChange={(e) => setSandbox({ ...sandbox, enabled: e.target.checked })} /> تفعيل Sandbox بعد اختبار /health</label>
        </div>
        {health.sandbox ? <p className="mt-3 text-sm">{health.sandbox.details} — {health.sandbox.latencyMs}ms</p> : null}
        <div className="mt-5 flex flex-wrap gap-2"><Button disabled={busy !== null} onClick={() => void save("sandbox")}><Save size={16} /> حفظ واختبار وتطبيق</Button><Button variant="secondary" disabled={busy !== null || !snapshot.sandbox.configured} onClick={() => void test("sandbox")}><ServerCog size={16} /> اختبار الحالي</Button></div>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Bot size={20} /><h3 className="text-lg font-extrabold">Browser Agent Runner</h3></div><p className="mt-2 text-sm leading-7 text-[var(--muted)]">جلسات Playwright مع قائمة نطاقات، موافقات للعمليات الحساسة، وحفظ حالة الجلسة مشفرة.</p></div><FeatureState enabled={snapshot.browser.enabled} configured={snapshot.browser.configured} source={snapshot.browser.source} /></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Runner URL"><Input dir="ltr" value={browser.runnerUrl} onChange={(e) => setBrowser({ ...browser, runnerUrl: e.target.value })} /></Field>
          <Field label="Shared Secret" hint={snapshot.browser.sharedSecretHint}><Input dir="ltr" type="password" value={browser.sharedSecret} onChange={(e) => setBrowser({ ...browser, sharedSecret: e.target.value })} /></Field>
          <Field label="مهلة المهمة بالدقائق"><Input type="number" min={1} max={30} value={browser.taskTimeoutMinutes} onChange={(e) => setBrowser({ ...browser, taskTimeoutMinutes: Number(e.target.value) })} /></Field>
          <Field label="أقصى خطوات"><Input type="number" min={1} max={100} value={browser.maxSteps} onChange={(e) => setBrowser({ ...browser, maxSteps: Number(e.target.value) })} /></Field>
          <Field label="أقصى صفحات"><Input type="number" min={1} max={10} value={browser.maxPages} onChange={(e) => setBrowser({ ...browser, maxPages: Number(e.target.value) })} /></Field>
          <Field label="أقصى تنزيل MB"><Input type="number" min={1} max={100} value={browser.allowedDownloadMb} onChange={(e) => setBrowser({ ...browser, allowedDownloadMb: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold"><input type="checkbox" checked={browser.interactiveLoginEnabled} onChange={(e) => setBrowser({ ...browser, interactiveLoginEnabled: e.target.checked })} /> السماح بتسجيل الدخول التفاعلي</label>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold"><input type="checkbox" checked={browser.screenshotsEnabled} onChange={(e) => setBrowser({ ...browser, screenshotsEnabled: e.target.checked })} /> حفظ لقطات الأدلة</label>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold sm:col-span-2"><input type="checkbox" checked={browser.enabled} onChange={(e) => setBrowser({ ...browser, enabled: e.target.checked })} /> تفعيل Browser Agent بعد اختبار /health</label>
        </div>
        {health.browser ? <p className="mt-3 text-sm">{health.browser.details} — {health.browser.latencyMs}ms</p> : null}
        <div className="mt-5 flex flex-wrap gap-2"><Button disabled={busy !== null} onClick={() => void save("browser")}><Save size={16} /> حفظ واختبار وتطبيق</Button><Button variant="secondary" disabled={busy !== null || !snapshot.browser.configured} onClick={() => void test("browser")}><ServerCog size={16} /> اختبار الحالي</Button></div>
      </Card>
    </div>
  </section>;
}
