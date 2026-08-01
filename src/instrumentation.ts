export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startNodeTelemetry } = await import("@/ai/observability/node-otel");
  await startNodeTelemetry("moataz-web");
}
