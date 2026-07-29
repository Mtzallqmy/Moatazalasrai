export type AiFeature = "MEMORY" | "RAG" | "WORKFLOWS" | "TOOLS" | "WORKER" | "OTEL";
export function aiFeatureEnabled(feature: AiFeature) {
  return process.env[`AI_${feature}_ENABLED`] === "true";
}
