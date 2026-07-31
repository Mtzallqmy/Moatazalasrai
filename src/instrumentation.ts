import { startNodeTelemetry } from "@/ai/observability/node-otel";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const shutdown = await startNodeTelemetry("moataz-web");
  if (!shutdown) return;
  const stop = () => { void shutdown().catch(() => undefined); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
