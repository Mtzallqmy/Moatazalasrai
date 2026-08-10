import {
  generateText,
  stepCountIs,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";
import { getProviderAdapter } from "@/lib/providers/registry";
import { ProviderError, type ProviderMessage } from "@/lib/providers/types";
import type { ProviderKind, ProviderTransportMode, ProviderTypeId } from "@/lib/providers/types";
import { createDirectLanguageModel } from "@/lib/ai-sdk/model-factory";
import { loadAgentMcpTools, type AgentToolBinding, type ToolRuntimeState } from "@/lib/ai-sdk/mcp-tools";
import { maxModelStepsPerRun } from "@/lib/ai-sdk/limits";
import { aiSdkTelemetry } from "@/lib/ai-sdk/telemetry";
import { persistRunStep } from "@/lib/ai-sdk/run-steps";
import { requestToolApproval } from "@/lib/ai-sdk/approvals";
import type { AgentRunCheckpointState } from "@/lib/ai-sdk/checkpoints";

export type AiSdkCandidate = {
  providerCredentialId: string;
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
  capabilities: Record<string, boolean | undefined>;
  providerTypeId?: ProviderTypeId;
  transportMode?: ProviderTransportMode;
};

export type AiSdkExecutionState = {
  emittedText: boolean;
  toolExecuted: boolean;
  toolResultSaved: boolean;
  sideEffectOccurred: boolean;
  approvalPending: boolean;
};

export type AiSdkExecutionResult = {
  status: "completed" | "waiting_approval";
  text: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  providerRequestId?: string;
  state: AiSdkExecutionState;
  approvalId?: string;
};

type ApprovalRequestPart = {
  type: "tool-approval-request";
  approvalId: string;
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  };
};

export class AiSdkCandidateError extends Error {
  constructor(
    public readonly providerError: ProviderError,
    public readonly executionState: AiSdkExecutionState,
  ) {
    super(providerError.message);
    this.name = "AiSdkCandidateError";
  }
}

function isApprovalRequestPart(value: unknown): value is ApprovalRequestPart {
  if (!value || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  if (part.type !== "tool-approval-request" || typeof part.approvalId !== "string") return false;
  if (!part.toolCall || typeof part.toolCall !== "object") return false;
  const toolCall = part.toolCall as Record<string, unknown>;
  return typeof toolCall.toolCallId === "string"
    && typeof toolCall.toolName === "string"
    && "input" in toolCall;
}

function findApprovalRequest(parts: readonly unknown[]) {
  for (const part of parts) {
    if (isApprovalRequestPart(part)) return part;
  }
  return undefined;
}

function asArguments(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function modelMessages(context: ProviderMessage[]) {
  let system = "";
  const messages: ModelMessage[] = [];
  for (const message of context) {
    if (message.role === "system") {
      const text = typeof message.content === "string"
        ? message.content
        : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }
    if (message.role === "assistant") {
      const text = typeof message.content === "string"
        ? message.content
        : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      messages.push({ role: "assistant", content: text });
      continue;
    }
    if (typeof message.content === "string") {
      messages.push({ role: "user", content: message.content });
      continue;
    }
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: string; mediaType: string }
    > = message.content.map((part) => part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "image" as const,
          image: `data:${part.mediaType};base64,${part.data}`,
          mediaType: part.mediaType,
        });
    messages.push({ role: "user", content });
  }
  return { system, messages };
}

function checkpointMessages(system: string, messages: ModelMessage[], responseMessages: ModelMessage[]) {
  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    ...messages,
    ...responseMessages,
  ] satisfies ModelMessage[];
}

function normalizedUsage(usage: LanguageModelUsage | undefined) {
  return {
    inputTokens: typeof usage?.inputTokens === "number" ? usage.inputTokens : null,
    outputTokens: typeof usage?.outputTokens === "number" ? usage.outputTokens : null,
  };
}

function safeProviderError(candidate: AiSdkCandidate, error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return new ProviderError("PROVIDER_CANCELLED", "تم إلغاء طلب المزود.", 499);
  if (error instanceof ProviderError) return error;
  try {
    return getProviderAdapter(candidate.provider).normalizeError(error);
  } catch {
    return new ProviderError("PROVIDER_REQUEST_FAILED", "تعذر إكمال طلب المزود.", 502);
  }
}

function initialState(): AiSdkExecutionState {
  return {
    emittedText: false,
    toolExecuted: false,
    toolResultSaved: false,
    sideEffectOccurred: false,
    approvalPending: false,
  };
}

async function runtimeTools(input: {
  organizationId: string;
  userId?: string | null;
  agentId: string;
  runId: string;
  allowedToolIds?: readonly string[] | null;
  toolsEnabled?: boolean;
  allocateStep: () => number;
}) {
  const state: ToolRuntimeState = {
    toolExecuted: false,
    toolResultSaved: false,
    sideEffectOccurred: false,
    allocateStep: input.allocateStep,
  };
  if (input.toolsEnabled === false) {
    return {
      tools: {},
      bindings: new Map<string, AgentToolBinding>(),
      hasTools: false,
      internalToolNames: [] as string[],
      state,
    };
  }
  const loaded = await loadAgentMcpTools({
    organizationId: input.organizationId,
    userId: input.userId,
    agentId: input.agentId,
    runId: input.runId,
    allowedToolIds: input.allowedToolIds,
    state,
  });
  return { ...loaded, state };
}

function assertToolCallingCapability(candidate: AiSdkCandidate, hasTools: boolean) {
  if (hasTools && candidate.capabilities.tools !== true && candidate.capabilities.toolCalling !== true) {
    throw new ProviderError(
      "TOOL_CALLING_MODEL_REQUIRED",
      "الوكيل مرتبط بأدوات، لكن النموذج المحدد لا يدعم Tool Calling.",
      422,
    );
  }
}

async function saveApproval(input: {
  organizationId: string;
  userId?: string | null;
  agentId: string;
  runId: string;
  conversationId: string;
  requestId: string;
  candidate: AiSdkCandidate;
  candidateIndex: number;
  messages: ModelMessage[];
  approval: ApprovalRequestPart;
  bindings: Awaited<ReturnType<typeof loadAgentMcpTools>>["bindings"];
  state: AiSdkExecutionState;
  allocateStep: () => number;
}) {
  const binding = input.bindings.get(input.approval.toolCall.toolName);
  if (!binding) {
    throw new ProviderError("MCP_TOOL_NOT_BOUND", "حاول النموذج استدعاء أداة غير مرتبطة بالوكيل.", 422);
  }
  const argumentsValue = asArguments(input.approval.toolCall.input);
  const checkpoint: AgentRunCheckpointState = {
    messages: input.messages,
    pendingApproval: {
      approvalId: input.approval.approvalId,
      toolCallId: input.approval.toolCall.toolCallId,
      toolName: input.approval.toolCall.toolName,
      toolId: binding.toolId,
      arguments: argumentsValue,
    },
    agentId: input.agentId,
    conversationId: input.conversationId,
    requestId: input.requestId,
    providerCredentialId: input.candidate.providerCredentialId,
    model: input.candidate.model,
    candidateIndex: input.candidateIndex,
    emittedText: input.state.emittedText,
    toolExecuted: input.state.toolExecuted,
    sideEffectOccurred: input.state.sideEffectOccurred,
    toolResultSaved: input.state.toolResultSaved,
  };
  await requestToolApproval({
    organizationId: input.organizationId,
    userId: input.userId,
    runId: input.runId,
    agentId: input.agentId,
    serverId: binding.serverId,
    toolId: binding.toolId,
    toolCallId: input.approval.toolCall.toolCallId,
    approvalId: input.approval.approvalId,
    arguments: argumentsValue,
    reason: `تتطلب الأداة ${binding.title ?? binding.originalName} موافقة بشرية وفق سياسة المخاطر.`,
    risk: binding.risk,
    capability: binding.capability,
    stepNumber: input.allocateStep(),
    checkpoint,
  });
}

export async function executeAiSdkCandidate(input: {
  organizationId: string;
  userId?: string | null;
  agentId: string;
  runId: string;
  conversationId: string;
  requestId: string;
  candidateIndex: number;
  candidate: AiSdkCandidate;
  context?: ProviderMessage[];
  resumeMessages?: ModelMessage[];
  allowedToolIds?: readonly string[] | null;
  toolsEnabled?: boolean;
  temperature: number;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
  allocateStep: () => number;
}): Promise<AiSdkExecutionResult> {
  const state = initialState();
  try {
    const converted = input.resumeMessages
      ? { system: "", messages: input.resumeMessages }
      : modelMessages(input.context ?? []);
    const loaded = await runtimeTools(input);
    assertToolCallingCapability(input.candidate, loaded.hasTools);
    const model = createDirectLanguageModel({
      provider: input.candidate.provider,
      apiKey: input.candidate.apiKey,
      baseUrl: input.candidate.baseUrl,
      model: input.candidate.model,
      organizationId: input.organizationId,
      requestId: input.requestId,
      providerTypeId: input.candidate.providerTypeId,
      transportMode: input.candidate.transportMode,
    });
    const result = await generateText({
      model,
      system: converted.system || undefined,
      messages: converted.messages,
      tools: loaded.hasTools ? loaded.tools : undefined,
      stopWhen: stepCountIs(maxModelStepsPerRun()),
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 0,
      abortSignal: input.abortSignal,
      timeout: { totalMs: 10 * 60_000, stepMs: 3 * 60_000 },
      experimental_include: { requestBody: false },
      experimental_telemetry: aiSdkTelemetry({
        organizationId: input.organizationId,
        agentId: input.agentId,
        runId: input.runId,
        providerKind: input.candidate.provider,
        model: input.candidate.model,
      }),
      onStepFinish: async (step) => {
        await persistRunStep({
          organizationId: input.organizationId,
          runId: input.runId,
          stepNumber: input.allocateStep(),
          stepType: "model",
          status: "completed",
          model: input.candidate.model,
          providerCredentialId: input.candidate.providerCredentialId,
          input: { toolCallCount: step.toolCalls.length },
          output: { finishReason: step.finishReason, toolResultCount: step.toolResults.length },
          usage: step.usage,
          metadata: {
            finishReason: step.finishReason,
            toolCallCount: step.toolCalls.length,
            toolResultCount: step.toolResults.length,
          },
        });
      },
    });
    state.toolExecuted = loaded.state.toolExecuted;
    state.toolResultSaved = loaded.state.toolResultSaved;
    state.sideEffectOccurred = loaded.state.sideEffectOccurred;
    const approval = findApprovalRequest(result.content);
    if (approval) {
      state.approvalPending = true;
      await saveApproval({
        ...input,
        messages: checkpointMessages(converted.system, converted.messages, result.response.messages),
        approval,
        bindings: loaded.bindings,
        state,
      });
      return {
        status: "waiting_approval",
        text: "",
        usage: normalizedUsage(result.totalUsage),
        providerRequestId: result.response.id,
        state,
        approvalId: approval.approvalId,
      };
    }
    return {
      status: "completed",
      text: result.text,
      usage: normalizedUsage(result.totalUsage),
      providerRequestId: result.response.id,
      state,
    };
  } catch (error) {
    throw new AiSdkCandidateError(safeProviderError(input.candidate, error, input.abortSignal), state);
  }
}

export async function* streamAiSdkCandidate(input: {
  organizationId: string;
  userId?: string | null;
  agentId: string;
  runId: string;
  conversationId: string;
  requestId: string;
  candidateIndex: number;
  candidate: AiSdkCandidate;
  context: ProviderMessage[];
  allowedToolIds?: readonly string[] | null;
  toolsEnabled?: boolean;
  temperature: number;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
  allocateStep: () => number;
}): AsyncGenerator<{ type: "delta"; text: string } | { type: "result"; result: AiSdkExecutionResult }> {
  const state = initialState();
  try {
    const converted = modelMessages(input.context);
    const loaded = await runtimeTools(input);
    assertToolCallingCapability(input.candidate, loaded.hasTools);
    const model = createDirectLanguageModel({
      provider: input.candidate.provider,
      apiKey: input.candidate.apiKey,
      baseUrl: input.candidate.baseUrl,
      model: input.candidate.model,
      organizationId: input.organizationId,
      requestId: input.requestId,
      providerTypeId: input.candidate.providerTypeId,
      transportMode: input.candidate.transportMode,
    });
    const result = streamText({
      model,
      system: converted.system || undefined,
      messages: converted.messages,
      tools: loaded.hasTools ? loaded.tools : undefined,
      stopWhen: stepCountIs(maxModelStepsPerRun()),
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 0,
      abortSignal: input.abortSignal,
      timeout: { totalMs: 10 * 60_000, stepMs: 3 * 60_000, chunkMs: 90_000 },
      experimental_include: { requestBody: false },
      experimental_telemetry: aiSdkTelemetry({
        organizationId: input.organizationId,
        agentId: input.agentId,
        runId: input.runId,
        providerKind: input.candidate.provider,
        model: input.candidate.model,
      }),
      onStepFinish: async (step) => {
        await persistRunStep({
          organizationId: input.organizationId,
          runId: input.runId,
          stepNumber: input.allocateStep(),
          stepType: "model",
          status: "completed",
          model: input.candidate.model,
          providerCredentialId: input.candidate.providerCredentialId,
          input: { toolCallCount: step.toolCalls.length },
          output: { finishReason: step.finishReason, toolResultCount: step.toolResults.length },
          usage: step.usage,
          metadata: {
            finishReason: step.finishReason,
            toolCallCount: step.toolCalls.length,
            toolResultCount: step.toolResults.length,
          },
        });
      },
    });
    for await (const text of result.textStream) {
      if (text) {
        state.emittedText = true;
        yield { type: "delta", text };
      }
    }
    state.toolExecuted = loaded.state.toolExecuted;
    state.toolResultSaved = loaded.state.toolResultSaved;
    state.sideEffectOccurred = loaded.state.sideEffectOccurred;
    const [content, totalUsage, response, text] = await Promise.all([
      result.content,
      result.totalUsage,
      result.response,
      result.text,
    ]);
    const approval = findApprovalRequest(content);
    if (approval) {
      state.approvalPending = true;
      await saveApproval({
        ...input,
        messages: checkpointMessages(converted.system, converted.messages, response.messages),
        approval,
        bindings: loaded.bindings,
        state,
      });
      yield {
        type: "result",
        result: {
          status: "waiting_approval",
          text,
          usage: normalizedUsage(totalUsage),
          providerRequestId: response.id,
          state,
          approvalId: approval.approvalId,
        },
      };
      return;
    }
    yield {
      type: "result",
      result: {
        status: "completed",
        text,
        usage: normalizedUsage(totalUsage),
        providerRequestId: response.id,
        state,
      },
    };
  } catch (error) {
    throw new AiSdkCandidateError(safeProviderError(input.candidate, error, input.abortSignal), state);
  }
}
