export const runStatusPresentation = {
  queued: { label: "في الانتظار", tone: "warning" },
  running: { label: "قيد التشغيل", tone: "info" },
  waiting_approval: { label: "بانتظار الموافقة", tone: "warning" },
  completed: { label: "مكتمل", tone: "success" },
  failed: { label: "فشل", tone: "danger" },
  cancelled: { label: "ملغي", tone: "muted" },
} as const;

export const agentLifecyclePresentation = {
  draft: { label: "مسودة", tone: "muted" },
  published: { label: "منشور", tone: "success" },
  archived: { label: "مؤرشف", tone: "muted" },
} as const;

export function friendlyModelName(value: string | null | undefined) {
  if (!value) return "اختيار تلقائي";
  const withoutProvider = value.split("/").at(-1) ?? value;
  const withoutVariant = withoutProvider.replace(/:(free|paid|latest)$/i, "");
  return withoutVariant
    .replace(/^gpt[-_]?oss[-_]?/i, "GPT OSS ")
    .replace(/^gpt[-_]?/i, "GPT ")
    .replace(/^deepseek[-_]?/i, "DeepSeek ")
    .replace(/^claude[-_]?/i, "Claude ")
    .replace(/^gemini[-_]?/i, "Gemini ")
    .replace(/[-_]+/g, " ")
    .replace(/\b(\d+)b\b/gi, "$1B")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ar", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} مللي ثانية`;
  return `${new Intl.NumberFormat("ar", { maximumFractionDigits: 1 }).format(value / 1000)} ث`;
}

export function relativeTime(value: string | Date | null | undefined, now = new Date()) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (!Number.isFinite(deltaSeconds)) return "—";
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });
  if (absolute < 60) return formatter.format(deltaSeconds, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}

export function detailedDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
