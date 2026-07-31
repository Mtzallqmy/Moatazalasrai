import { SpanStatusCode, trace } from "@opentelemetry/api";

const forbidden = /(^|[._-])(api[_-]?key|secret|password|authorization|cookie|access[_-]?token|refresh[_-]?token|prompt|message[_-]?content|tool[_-]?(arguments|output)|document[_-]?text|file[_-]?content)([._-]|$)/i;
const tracer = trace.getTracer("moataz-agent-platform");

type SafePrimitive = string | number | boolean;

function safeValue(value: unknown): SafePrimitive | SafePrimitive[] | undefined {
  if (typeof value === "string") return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value.map(safeValue).filter((item): item is SafePrimitive =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean");
    return items.slice(0, 30);
  }
  return undefined;
}

export function safeTelemetry(fields: Record<string, unknown>) {
  const entries: Array<[string, SafePrimitive | SafePrimitive[]]> = [];
  for (const [key, value] of Object.entries(fields)) {
    if (forbidden.test(key) || value === undefined || value === null) continue;
    const safe = safeValue(value);
    if (safe !== undefined) entries.push([key, safe]);
  }
  return Object.fromEntries(entries);
}

function spanName(fields: Record<string, unknown>) {
  const operation = fields.operation ?? fields.event;
  return typeof operation === "string" && operation.length <= 120 ? operation : "platform.operation";
}

export async function withTelemetry<T>(fields: Record<string, unknown>, operation: () => Promise<T>) {
  const started = Date.now();
  const sanitized = safeTelemetry(fields);
  return tracer.startActiveSpan(spanName(fields), { attributes: sanitized }, async (span) => {
    try {
      const result = await operation();
      const durationMs = Date.now() - started;
      span.setAttribute("status", "ok");
      span.setAttribute("durationMs", durationMs);
      span.setStatus({ code: SpanStatusCode.OK });
      console.info(JSON.stringify({ ...sanitized, status: "ok", durationMs }));
      return result;
    } catch (error) {
      const durationMs = Date.now() - started;
      const errorCode = error instanceof Error ? error.name : "UNKNOWN";
      span.setAttribute("status", "error");
      span.setAttribute("errorCode", errorCode);
      span.setAttribute("durationMs", durationMs);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
      console.error(JSON.stringify({ ...sanitized, status: "error", errorCode, durationMs }));
      throw error;
    } finally {
      span.end();
    }
  });
}

export function recordTelemetryEvent(fields: Record<string, unknown>) {
  const sanitized = safeTelemetry(fields);
  const span = tracer.startSpan(spanName(fields), { attributes: sanitized });
  span.addEvent(spanName(fields), sanitized);
  span.end();
  return sanitized;
}
