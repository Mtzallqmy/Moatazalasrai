"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  LoaderCircle,
  Server,
  ShieldAlert,
  UserRoundCog,
  Wrench,
  X,
} from "lucide-react";

type Approval = {
  id: string;
  approvalId: string;
  runId: string | null;
  toolCallId: string | null;
  toolId: string;
  toolName: string;
  serverName: string;
  agentName: string;
  risk: string | null;
  capability: string | null;
  reason: string | null;
  argumentsSummary: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
};

type ApiPayload<T> = { success?: boolean; data?: T; error?: { message?: string } };

const riskLabels: Record<string, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "مرتفعة",
};

function summaryRows(summary: Record<string, unknown>) {
  return Object.entries(summary).slice(0, 12).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

function remainingLabel(expiresAt: string) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (seconds < 60) return `${seconds} ثانية`;
  return `${Math.floor(seconds / 60)} دقيقة`;
}

export function ToolApprovalsManager() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const pollControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/tool-approvals", { cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as ApiPayload<Approval[]> | null;
    if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تحميل طلبات الموافقة.");
    setApprovals(payload.data ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "تعذر تحميل طلبات الموافقة."); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      pollControllerRef.current?.abort();
      const controller = new AbortController();
      pollControllerRef.current = controller;
      void load(controller.signal).catch(() => undefined);
    }, 5000);
    return () => { window.clearInterval(timer); pollControllerRef.current?.abort(); pollControllerRef.current = null; };
  }, [load]);

  const sorted = useMemo(() => [...approvals].sort((left, right) =>
    new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime()), [approvals]);

  async function decide(approval: Approval, decision: "approved" | "rejected") {
    setBusyId(approval.approvalId);
    setMessage("");
    try {
      const response = await fetch("/api/tool-approvals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: approval.approvalId, decision }),
      });
      const payload = await response.json().catch(() => null) as ApiPayload<unknown> | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تسجيل القرار.");
      setApprovals((current) => current.filter((item) => item.approvalId !== approval.approvalId));
      setMessage(decision === "approved"
        ? "تمت الموافقة ووُضع استئناف التشغيل في Worker."
        : "تم الرفض ووُضع استئناف التشغيل دون تنفيذ الأداة.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تسجيل القرار.");
      await load().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {message ? <p role="status" className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>{message}</p> : null}
      {sorted.length === 0 ? (
        <section className="dashboard-panel empty-state">
          لا توجد أدوات تنتظر موافقة بشرية حاليًا.
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sorted.map((approval) => {
            const busy = busyId === approval.approvalId;
            const rows = summaryRows(approval.argumentsSummary);
            return (
              <article className="dashboard-panel p-4 sm:p-5" key={approval.approvalId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="metric-icon"><ShieldAlert size={19} /></span>
                    <div>
                      <h2 className="font-extrabold">{approval.toolName}</h2>
                      <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>{approval.reason ?? "تتطلب سياسة الأداة قرارًا بشريًا قبل التنفيذ."}</p>
                    </div>
                  </div>
                  <span className={`status-chip status-${approval.risk === "high" ? "failed" : "queued"}`}>
                    خطورة {riskLabels[approval.risk ?? ""] ?? approval.risk ?? "غير محددة"}
                  </span>
                </div>

                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}><Server size={16} /><span><b>الخادم:</b> {approval.serverName}</span></div>
                  <div className="flex items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}><UserRoundCog size={16} /><span><b>الوكيل:</b> {approval.agentName}</span></div>
                  <div className="flex items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}><Wrench size={16} /><span><b>القدرة:</b> {approval.capability ?? "غير محددة"}</span></div>
                  <div className="flex items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}><Clock3 size={16} /><span><b>تنتهي خلال:</b> {remainingLabel(approval.expiresAt)}</span></div>
                </dl>

                <section className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}>
                  <h3 className="text-sm font-bold">ملخص المدخلات المنقح</h3>
                  {rows.length === 0 ? <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>لا توجد حقول قابلة للعرض.</p> : (
                    <dl className="mt-3 grid gap-2">
                      {rows.map((row) => <div className="grid gap-1 text-xs sm:grid-cols-[140px_1fr]" key={row.key}><dt className="font-bold" dir="ltr">{row.key}</dt><dd className="break-words" dir="auto">{row.value}</dd></div>)}
                    </dl>
                  )}
                </section>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="primary-button" disabled={busy} type="button" onClick={() => void decide(approval, "approved")}>
                    {busy ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />} موافقة واستئناف
                  </button>
                  <button className="danger-button" disabled={busy} type="button" onClick={() => void decide(approval, "rejected")}>
                    {busy ? <LoaderCircle className="animate-spin" size={17} /> : <X size={17} />} رفض
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
