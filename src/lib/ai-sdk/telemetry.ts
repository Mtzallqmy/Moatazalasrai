export function aiSdkTelemetry(input: {
  organizationId: string;
  agentId: string;
  runId: string;
  providerKind: string;
  model: string;
  functionId?: string;
}) {
  return {
    isEnabled: process.env.AI_OTEL_ENABLED === "true",
    functionId: input.functionId ?? "agent.run",
    recordInputs: false,
    recordOutputs: false,
    metadata: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      runId: input.runId,
      providerKind: input.providerKind,
      model: input.model,
    },
  } as const;
}
