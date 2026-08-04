import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { toolNeedsApproval } from "@/lib/ai-sdk/approval-policy";
import {
  maxModelStepsPerRun,
  maxTotalToolCallsPerRun,
  runCheckpointTtlSeconds,
  toolApprovalTtlSeconds,
} from "@/lib/ai-sdk/limits";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { taskList } from "@/worker/task-list";

const openaiMock = vi.fn(() => ({ provider: "openai" }));
const anthropicMock = vi.fn(() => ({ provider: "anthropic" }));
const googleMock = vi.fn(() => ({ provider: "google" }));
const compatibleMock = vi.fn(() => ({ provider: "openai-compatible" }));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => openaiMock }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => anthropicMock }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: () => googleMock }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => compatibleMock }));

const previousEnvironment = {
  MAX_MODEL_STEPS_PER_RUN: process.env.MAX_MODEL_STEPS_PER_RUN,
  MAX_TOTAL_TOOL_CALLS_PER_RUN: process.env.MAX_TOTAL_TOOL_CALLS_PER_RUN,
  TOOL_APPROVAL_TTL_SECONDS: process.env.TOOL_APPROVAL_TTL_SECONDS,
  RUN_CHECKPOINT_TTL_SECONDS: process.env.RUN_CHECKPOINT_TTL_SECONDS,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("AI SDK direct model factory", () => {
  test("creates a direct openai model without a gateway", async () => {
    const { createDirectLanguageModel } = await import("@/lib/ai-sdk/model-factory");
    expect(createDirectLanguageModel({
      provider: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
    })).toEqual({ provider: "openai" });
    expect(openaiMock).toHaveBeenCalledWith("gpt-test");
  });

  test("creates a direct anthropic model without a gateway", async () => {
    const { createDirectLanguageModel } = await import("@/lib/ai-sdk/model-factory");
    expect(createDirectLanguageModel({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-test",
    })).toEqual({ provider: "anthropic" });
    expect(anthropicMock).toHaveBeenCalledWith("claude-test");
  });

  test("creates a direct gemini model without a gateway", async () => {
    const { createDirectLanguageModel } = await import("@/lib/ai-sdk/model-factory");
    expect(createDirectLanguageModel({
      provider: "gemini",
      apiKey: "gemini-test",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-test",
    })).toEqual({ provider: "google" });
    expect(googleMock).toHaveBeenCalledWith("gemini-test");
  });

  test("creates a direct openai_compatible model without a gateway", async () => {
    const { createDirectLanguageModel } = await import("@/lib/ai-sdk/model-factory");
    expect(createDirectLanguageModel({
      provider: "openai_compatible",
      apiKey: "compat-test",
      baseUrl: "https://example.com/v1",
      model: "compat-model",
    })).toEqual({ provider: "openai-compatible" });
    expect(compatibleMock).toHaveBeenCalledWith("compat-model");
  });

  test("rejects missing decrypted credentials at the server boundary", async () => {
    const { createDirectLanguageModel } = await import("@/lib/ai-sdk/model-factory");
    expect(() => createDirectLanguageModel({
      provider: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
    })).toThrow();
  });
});

describe("tool approval policy", () => {
  test("low-risk read-only tools execute automatically", () => {
    expect(toolNeedsApproval({ approvalMode: "risk_based", riskLevel: "low", capability: "read" })).toBe(false);
  });
  test("always mode requires approval", () => {
    expect(toolNeedsApproval({ approvalMode: "always", riskLevel: "low", capability: "read" })).toBe(true);
  });
  for (const capability of ["write", "delete", "publish", "payment", "send"] as const) {
    test(`${capability} capability always requires approval`, () => {
      expect(toolNeedsApproval({ approvalMode: "never", riskLevel: "low", capability })).toBe(true);
    });
  }
  test("medium and high risk require approval in risk-based mode", () => {
    expect(toolNeedsApproval({ approvalMode: "risk_based", riskLevel: "medium", capability: "read" })).toBe(true);
    expect(toolNeedsApproval({ approvalMode: "risk_based", riskLevel: "high", capability: "read" })).toBe(true);
  });
  test("sensitive approval summaries are redacted", async () => {
    const { summarizeToolArguments } = await import("@/lib/ai-sdk/approval-policy");
    expect(summarizeToolArguments({ password: "secret", query: "safe", nested: { authorization: "Bearer token" } }))
      .toEqual({ password: "[REDACTED]", query: "safe", nested: { authorization: "[REDACTED]" } });
  });
});

describe("runtime limits and observability safety", () => {
  test("configuration is clamped within production boundaries", () => {
    process.env.MAX_MODEL_STEPS_PER_RUN = "999";
    process.env.MAX_TOTAL_TOOL_CALLS_PER_RUN = "999";
    process.env.TOOL_APPROVAL_TTL_SECONDS = "1";
    process.env.RUN_CHECKPOINT_TTL_SECONDS = "999999999";
    expect(maxModelStepsPerRun()).toBe(24);
    expect(maxTotalToolCallsPerRun()).toBe(40);
    expect(toolApprovalTtlSeconds()).toBe(60);
    expect(runCheckpointTtlSeconds()).toBe(7 * 24 * 60 * 60);
  });

  test("telemetry keeps token counts but drops secrets and content", () => {
    const fields = safeTelemetry({
      operation: "agent.model.step",
      inputTokens: 120,
      outputTokens: 50,
      apiKey: "sk-secret",
      authorization: "Bearer token",
      prompt: "private prompt",
      messageContent: "private message",
    });
    expect(fields).toMatchObject({ operation: "agent.model.step", inputTokens: 120, outputTokens: 50 });
    expect(fields).not.toHaveProperty("apiKey");
    expect(fields).not.toHaveProperty("authorization");
    expect(fields).not.toHaveProperty("prompt");
    expect(fields).not.toHaveProperty("messageContent");
  });

  test("worker task list contains only implemented handlers", () => {
    expect(Object.keys(taskList).sort()).toEqual([
      "agent-run-resume",
      "agent-team-run",
      "attachment-scan",
      "browser-task-execute",
      "browser-task-resume",
      "document-parse",
      "sandbox-artifact-cleanup",
      "sandbox-cleanup",
      "sandbox-create",
      "sandbox-execute",
      "sandbox-health-check",
      "sandbox-reset",
      "sandbox-resume",
    ]);
    expect(Object.keys(taskList)).not.toContain("document-embed");
    expect(Object.keys(taskList)).not.toContain("memory-compact");
    expect(Object.keys(taskList)).not.toContain("evaluation-run");
    expect(Object.keys(taskList)).not.toContain("integration-sync");
  });
});
