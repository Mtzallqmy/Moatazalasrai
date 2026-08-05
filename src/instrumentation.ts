export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startNodeTelemetry } = await import("@/ai/observability/node-otel");
  await startNodeTelemetry("moataz-web");
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { initializeWhatsAppFromEnvironment } = await import("@/lib/platform/whatsapp-environment");
  await initializeWhatsAppFromEnvironment({ force: true });
}
