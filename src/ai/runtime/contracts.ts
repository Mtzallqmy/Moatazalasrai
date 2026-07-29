import type { z } from "zod";
export type RuntimeEvent =
  | { type: "run.started"; runId: string; at: string }
  | { type: "message.delta"; runId: string; delta: string; at: string }
  | { type: "tool.requested" | "tool.completed"; runId: string; callId: string; toolId: string; at: string }
  | { type: "tool.failed"; runId: string; callId: string; toolId: string; errorCode: string; at: string }
  | { type: "run.completed"; runId: string; output: string; at: string }
  | { type: "run.failed" | "run.cancelled"; runId: string; errorCode?: string; at: string };
export type ToolRisk = "low" | "medium" | "high" | "critical";
export type ApprovalMode = "never" | "always" | "risk_based";
export interface RuntimeContext {
  requestId: string; runId: string; organizationId: string; userId: string; agentId: string;
  agentVersionId: string; signal: AbortSignal;
}
export interface RuntimeToolDefinition {
  id: string; name: string; description: string; inputSchema: z.ZodType;
  risk: ToolRisk; approvalMode: ApprovalMode; timeoutMs: number;
}
export interface RuntimeRequest {
  context: RuntimeContext; model: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; toolCallId?: string }>;
  temperature?: number; maxOutputTokens?: number; tools: RuntimeToolDefinition[];
}
export interface RuntimeResult { output: string; providerRequestId?: string; usage?: { inputTokens?: number; outputTokens?: number } }
export interface AgentRuntime {
  readonly id: string;
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
  stream(request: RuntimeRequest): AsyncIterable<RuntimeEvent>;
}
