const SENSITIVE_KEY = /(token|secret|authorization|api.?key|password|cookie|credential)/i;

export function redactRunEventValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return value.slice(0, 1_000);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactRunEventValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : redactRunEventValue(nested, depth + 1),
    ]));
  }
  return value;
}

export function redactRunEventPayload(payload: Record<string, unknown>) {
  return redactRunEventValue(payload) as Record<string, unknown>;
}
