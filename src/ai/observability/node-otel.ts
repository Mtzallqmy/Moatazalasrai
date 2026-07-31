type GlobalTelemetryState = typeof globalThis & {
  __moatazOtelServices?: Map<string, () => Promise<void>>;
};

function exporterHeaders(value: string | undefined) {
  if (!value?.trim()) return undefined;
  return Object.fromEntries(value.split(",").flatMap((entry) => {
    const index = entry.indexOf("=");
    if (index <= 0) return [];
    const key = entry.slice(0, index).trim();
    const headerValue = entry.slice(index + 1).trim();
    return key && headerValue ? [[key, headerValue]] : [];
  }));
}

export async function startNodeTelemetry(serviceName: string) {
  if (process.env.AI_OTEL_ENABLED !== "true") return undefined;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    console.warn(JSON.stringify({ level: "warn", event: "otel.disabled", serviceName, reason: "OTEL_EXPORTER_OTLP_ENDPOINT_MISSING" }));
    return undefined;
  }
  const state = globalThis as GlobalTelemetryState;
  state.__moatazOtelServices ??= new Map();
  const existing = state.__moatazOtelServices.get(serviceName);
  if (existing) return existing;

  const [{ NodeSDK }, { OTLPTraceExporter }] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
  ]);
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
      headers: exporterHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    }),
    serviceName,
  });
  sdk.start();
  const shutdown = async () => {
    if (!state.__moatazOtelServices?.has(serviceName)) return;
    state.__moatazOtelServices.delete(serviceName);
    await sdk.shutdown();
  };
  state.__moatazOtelServices.set(serviceName, shutdown);
  console.info(JSON.stringify({ level: "info", event: "otel.started", serviceName }));
  return shutdown;
}
