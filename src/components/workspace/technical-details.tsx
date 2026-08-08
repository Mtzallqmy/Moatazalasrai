"use client";

import { useEffect, useState } from "react";
import { Braces, Clock3, Gauge, Hash, Wrench } from "lucide-react";
import { apiRequest } from "@/lib/http/client";
import { formatDurationMs, formatCompactNumber, friendlyModelName } from "@/lib/ui/presentation";

let developerModeValue: boolean | null = null;
let developerModePromise: Promise<boolean> | null = null;

function loadDeveloperMode() {
  if (developerModeValue !== null) return Promise.resolve(developerModeValue);
  developerModePromise ??= apiRequest<{ enabled: boolean }>("/api/dashboard/preferences/developer-mode")
    .then((result) => {
      developerModeValue = result.enabled;
      return result.enabled;
    })
    .catch(() => false);
  return developerModePromise;
}

export function TechnicalDetails({
  model,
  provider,
  latencyMs,
  inputTokens,
  outputTokens,
  runId,
  errorCode,
  toolCalls,
}: {
  model?: string | null;
  provider?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  runId?: string | null;
  errorCode?: string | null;
  toolCalls?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const totalTokens = inputTokens !== null && inputTokens !== undefined && outputTokens !== null && outputTokens !== undefined
    ? inputTokens + outputTokens
    : null;
  const hasDetails = Boolean(model || provider || runId || errorCode || latencyMs !== null && latencyMs !== undefined
    || inputTokens !== null && inputTokens !== undefined || outputTokens !== null && outputTokens !== undefined || toolCalls);

  useEffect(() => {
    let active = true;
    const apply = (enabled: boolean) => {
      developerModeValue = enabled;
      if (active) setOpen(enabled);
    };
    void loadDeveloperMode().then(apply);
    const onPreference = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      if (typeof custom.detail?.enabled === "boolean") apply(custom.detail.enabled);
    };
    window.addEventListener("moataz:developer-mode", onPreference);
    return () => {
      active = false;
      window.removeEventListener("moataz:developer-mode", onPreference);
    };
  }, []);

  if (!hasDetails) return null;

  return (
    <details className="technical-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><Braces size={14} aria-hidden="true" /> التفاصيل التقنية</summary>
      <div className="technical-details-grid">
        {model ? <div><span>النموذج</span><b>{friendlyModelName(model)}</b><code className="technical-value">{model}</code></div> : null}
        {provider ? <div><span>المزوّد</span><bdi className="technical-value">{provider}</bdi></div> : null}
        {latencyMs !== null && latencyMs !== undefined ? <div><span><Clock3 size={13} /> زمن الاستجابة</span><b>{formatDurationMs(latencyMs)}</b></div> : null}
        {inputTokens !== null && inputTokens !== undefined ? <div><span><Gauge size={13} /> Input</span><b>{formatCompactNumber(inputTokens)}</b></div> : null}
        {outputTokens !== null && outputTokens !== undefined ? <div><span><Gauge size={13} /> Output</span><b>{formatCompactNumber(outputTokens)}</b></div> : null}
        {totalTokens !== null ? <div><span><Gauge size={13} /> Total</span><b>{formatCompactNumber(totalTokens)}</b></div> : null}
        {toolCalls ? <div><span><Wrench size={13} /> Tool calls</span><b>{formatCompactNumber(toolCalls)}</b></div> : null}
        {runId ? <div className="technical-details-wide"><span><Hash size={13} /> Run ID</span><code className="technical-value">{runId}</code></div> : null}
        {errorCode ? <div className="technical-details-wide"><span>رمز الخطأ</span><code className="technical-value">{errorCode}</code></div> : null}
      </div>
    </details>
  );
}
