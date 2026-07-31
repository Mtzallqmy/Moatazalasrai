type GlobalTelemetryState = typeof globalThis & {
  __moatazOtelStarted?: boolean;
  __moatazOtelShutdown?: () => Promise<void>;
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

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.AI_OTEL_ENABLED !== "true") return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    console.warn(JSON.stringify({ level: "warn", event: "otel.disabled", reason: "OTEL_EXPORTER_OTLP_ENDPOINT_MISSING" }));
    return;
  }
  const state = globalThis as GlobalTelemetryState;
  if (state.__moatazOtelStarted) return;
  state.__moatazOtelStarted = true;

  const [{ NodeSDK }, { OTLPTraceExporter }] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
  ]);
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
      headers: exporterHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    }),
    serviceName: "moataz-web",
  });
  sdk.start();
  state.__moatazOtelShutdown = async () => { await sdk.shutdown(); };

  const shutdown = () => {
    void state.__moatazOtelShutdown?.().catch(() => undefined);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  console.info(JSON.stringify({ level: "info", event: "otel.started", service: "moataz-web" }));
}
