"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, MessageCircle, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

type VariableDiagnostic = {
  name: string;
  loaded: boolean;
  displayValue: string | null;
  aliasFound: string | null;
};

type Health = {
  status: "healthy" | "unreachable" | "invalid_configuration";
  category: string;
  checkedAt: string;
  latencyMs: number;
  details: string;
  action: string | null;
  httpStatus: number | null;
  metaCode: number | null;
  metaSubcode: number | null;
  traceId: string | null;
  phone: {
    id: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
  } | null;
  webhook: {
    url: string;
    verifyTokenLoaded: boolean;
    subscriptionStatus: "subscribed" | "not_subscribed" | "unknown";
    appIdFound: boolean;
  };
};

type Report = {
  checkedAt: string;
  source: "environment" | "database" | "none";
  enabled: boolean;
  persisted: boolean;
  changed: boolean;
  fingerprint: string | null;
  inspection: {
    authoritative: boolean;
    complete: boolean;
    valid: boolean;
    runtimeEnvironment: string;
    railwayEnvironment: string | null;
    loadedCount: number;
    requiredCount: number;
    missing: string[];
    invalid: Array<{ name: string; reason: string }>;
    warnings: string[];
    variables: VariableDiagnostic[];
  };
  health: Health | null;
  persistenceError: string | null;
};

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; requestId?: string } };

type OperationResult = Report | { report: Report; messageId: string; recipient: string | null };

function envelopeError(payload: Envelope<unknown> | null, fallback: string) {
  if (!payload || payload.success) return fallback;
  return `${payload.error.message}${payload.error.requestId ? ` (${payload.error.requestId})` : ""}`;
}

function healthLabel(health: Health | null, enabled: boolean) {
  if (health?.status === "healthy" && enabled) return { tone: "success" as const, label: "Meta متصل" };
  if (health) return { tone: "danger" as const, label: "اختبار Meta فشل" };
  return { tone: "warning" as const, label: "لم يُختبر بعد" };
}

export function WhatsAppRuntimeStatus() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"load" | "refresh" | "send" | null>("load");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/whatsapp-runtime", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as Envelope<Report> | null;
      if (!response.ok || !payload?.success) throw new Error(envelopeError(payload, "تعذر تحميل حالة WhatsApp."));
      setReport(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل حالة WhatsApp.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function operation(action: "refresh" | "send_test") {
    setBusy(action === "refresh" ? "refresh" : "send");
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/whatsapp-runtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => null) as Envelope<OperationResult> | null;
      if (!response.ok || !payload?.success) throw new Error(envelopeError(payload, "تعذر تنفيذ اختبار WhatsApp."));
      const next = "report" in payload.data ? payload.data.report : payload.data;
      setReport(next);
      setMessage(
        action === "send_test" && "messageId" in payload.data
          ? `تم قبول الرسالة الاختبارية من Meta. Message ID: ${payload.data.messageId}`
          : next.health?.details || "تم تحديث حالة WhatsApp.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تنفيذ اختبار WhatsApp.");
    } finally {
      setBusy(null);
    }
  }

  if (!report && busy === "load") {
    return <Card className="p-6 text-center"><Loader2 className="mx-auto animate-spin" /><p className="mt-3 text-sm text-[var(--muted)]">جارٍ فحص متغيرات Railway وMeta...</p></Card>;
  }

  if (!report) {
    return <Card className="p-5"><CircleAlert className="me-2 inline text-red-600" size={18} />{message || "تعذر تحميل تشخيص WhatsApp."}</Card>;
  }

  const state = healthLabel(report.health, report.enabled);
  const webhookReady = report.health?.webhook.verifyTokenLoaded
    && report.health.webhook.subscriptionStatus === "subscribed";

  return <Card className="p-5 sm:p-6" aria-label="حالة WhatsApp من بيئة Railway">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2"><MessageCircle size={21} /><h2 className="text-xl font-extrabold">WhatsApp Cloud API — Environment Bootstrap</h2></div>
        <p className="mt-2 max-w-4xl text-sm leading-7 text-[var(--muted)]">تُقرأ القيم مباشرة من بيئة تشغيل Railway، وتُحدّث النسخة المشفرة في PostgreSQL تلقائيًا. لا توجد حاجة لإدخال App Secret أو Access Token داخل الموقع.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tone={state.tone}>{state.label}</Badge>
        <Badge tone={report.persisted ? "success" : "warning"}>{report.persisted ? "مزامن مع PostgreSQL" : "غير محفوظ"}</Badge>
      </div>
    </div>

    {message ? <div role="status" className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">{message}</div> : null}

    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-xs text-[var(--muted)]">بيئة التشغيل</p><p className="mt-1 font-bold" dir="ltr">{report.inspection.railwayEnvironment || report.inspection.runtimeEnvironment}</p></div>
      <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-xs text-[var(--muted)]">المتغيرات المقروءة</p><p className="mt-1 font-bold">{report.inspection.loadedCount} / {report.inspection.requiredCount}</p></div>
      <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-xs text-[var(--muted)]">Phone Number ID</p><p className="mt-1 break-all font-bold" dir="ltr">{report.health?.phone?.id || "—"}</p></div>
      <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-xs text-[var(--muted)]">Webhook</p><p className="mt-1 font-bold">{webhookReady ? "جاهز ومشترك" : report.health?.webhook.subscriptionStatus === "not_subscribed" ? "غير مشترك في WABA" : "قيد التحقق"}</p></div>
    </div>

    <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="min-w-full text-sm">
        <thead className="bg-[var(--surface-muted)] text-start"><tr><th className="p-3 text-start">المتغير</th><th className="p-3 text-start">الحالة</th><th className="p-3 text-start">القيمة الآمنة</th></tr></thead>
        <tbody>{report.inspection.variables.map((variable) => <tr key={variable.name} className="border-t border-[var(--border)]"><td className="p-3 font-mono text-xs" dir="ltr">{variable.name}</td><td className="p-3">{variable.loaded ? <span className="text-emerald-700">محمّل</span> : <span className="text-red-700">غير مقروء</span>}</td><td className="p-3"><bdi dir="ltr">{variable.displayValue || (variable.aliasFound ? `وجد اسم بديل: ${variable.aliasFound}` : "—")}</bdi></td></tr>)}</tbody>
      </table>
    </div>

    {report.inspection.invalid.length ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-bold">قيم غير صالحة:</p>{report.inspection.invalid.map((item) => <p key={`${item.name}-${item.reason}`} className="mt-1"><bdi dir="ltr">{item.name}</bdi>: {item.reason}</p>)}</div> : null}
    {report.inspection.missing.length ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">متغيرات غير محمّلة داخل العملية:</p><p className="mt-1 font-mono text-xs" dir="ltr">{report.inspection.missing.join(", ")}</p><p className="mt-2">تأكد من وضعها في خدمة Railway الصحيحة وبيئة Production ثم نفّذ Redeploy، وليس Restart فقط عند الحاجة إلى نشر جديد.</p></div> : null}

    {report.health ? <div className="mt-4 rounded-xl border border-[var(--border)] p-4 text-sm">
      <div className="flex items-center gap-2">{report.health.status === "healthy" ? <CheckCircle2 className="text-emerald-600" size={18} /> : <CircleAlert className="text-red-600" size={18} />}<strong>{report.health.details}</strong></div>
      <p className="mt-2 text-[var(--muted)]">الفئة: <bdi dir="ltr">{report.health.category}</bdi> — {report.health.latencyMs}ms</p>
      {report.health.action ? <p className="mt-2">الإجراء: {report.health.action}</p> : null}
      {report.health.metaCode || report.health.traceId ? <p className="mt-2 font-mono text-xs" dir="ltr">HTTP={report.health.httpStatus ?? "—"} code={report.health.metaCode ?? "—"} subcode={report.health.metaSubcode ?? "—"} trace={report.health.traceId ?? "—"}</p> : null}
      <p className="mt-2 break-all"><ShieldCheck className="me-2 inline" size={16} />Webhook URL: <code dir="ltr">{report.health.webhook.url}</code></p>
    </div> : null}

    {report.persistenceError ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">فشل حفظ النسخة المشفرة: {report.persistenceError}</div> : null}

    <div className="mt-5 flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy !== null} onClick={() => void operation("refresh")}><RefreshCw className={busy === "refresh" ? "animate-spin" : ""} size={16} /> إعادة قراءة البيئة واختبار Meta</Button>
      <Button disabled={busy !== null || !report.enabled} onClick={() => void operation("send_test")}><Send size={16} /> إرسال رسالة اختبار للحساب المرتبط</Button>
    </div>
  </Card>;
}
