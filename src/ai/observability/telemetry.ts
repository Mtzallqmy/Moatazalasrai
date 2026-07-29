const forbidden = /secret|password|authorization|cookie|token|content|prompt|message/i;
export function safeTelemetry(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => !forbidden.test(key) && value !== undefined));
}
export async function withTelemetry<T>(fields: Record<string, unknown>, operation: () => Promise<T>) {
  const started = Date.now();
  try {
    const result = await operation();
    console.info(JSON.stringify(safeTelemetry({ ...fields, status: "ok", durationMs: Date.now() - started })));
    return result;
  } catch (error) {
    console.error(JSON.stringify(safeTelemetry({ ...fields, status: "error", errorCode: error instanceof Error ? error.name : "UNKNOWN", durationMs: Date.now() - started })));
    throw error;
  }
}
