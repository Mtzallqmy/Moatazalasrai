import { afterEach, describe, expect, test } from "vitest";
import { evaluateToolApproval, redactedArgumentSummary } from "@/lib/ai-sdk/approval-policy";
import { createDirectLanguageModel } from "@/lib/ai-sdk/model-factory";
import {
  maxModelStepsPerRun,
  maxTotalToolCallsPerRun,
  runCheckpointTtlSeconds,
  toolApprovalTtlSeconds,
} from "@/lib/ai-sdk/limits";
import { safeTelemetry } from "@/ai/observability/telemetry";
import { taskList } from "@/worker/task-list";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("AI SDK direct model factory", () => {
  test.each([
    ["openai", "https://api.openai.com/v1", "gpt-4.1-mini"],
    ["anthropic", "https://api.anthropic.com/v1", "claude-sonnet-4-5"],
    ["gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.5-flash"],
    ["openai_compatible", "https://openrouter.ai/api/v1", "openai/gpt-4.1-mini"],
  ] as const)("creates a direct %s model without a gateway", (provider, baseUrl, model) => {
    const languageModel = createDirectLanguageModel({ provider, baseUrl, model, apiKey: "unit-test-key" });
    expect(languageModel).toBeDefined();
    expect(languageModel.modelId).toBe(model);
    expect(JSON.stringify(languageModel)).not.toContain("unit-test-key");
  });

  test("rejects missing decrypted credentials at the server boundary", () => {
    expect(() => createDirectLanguageModel({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "",
    })).toThrow("AI_SDK_API_KEY_REQUIRED");
  });
});

describe("tool approval policy", () => {
  const base = {
    name: "lookup_customer",
    description: "Read customer information",
    annotations: { readOnlyHint: true },
    arguments: { customerId: "123" },
  };

  test("low-risk read-only tools execute automatically", () => {
    expect(evaluateToolApproval({
      ...base,
      approvalMode: "risk_based",
      risk: "low",
      capability: "read",
    })).toMatchObject({ requiresApproval: false, readOnly: true, sideEffectful: false });
  });

  test("always mode requires approval", () => {
    expect(evaluateToolApproval({
      ...base,
      approvalMode: "always",
      risk: "low",
      capability: "read",
    }).requiresApproval).toBe(true);
  });

  test.each(["write", "delete", "publish", "payment", "send"])("%s capability always requires approval", (capability) => {
    expect(evaluateToolApproval({
      ...base,
      approvalMode: "never",
      risk: "low",
      capability,
      annotations: {},
    })).toMatchObject({ requiresApproval: true, sideEffectful: true });
  });

  test("medium and high risk require approval in risk-based mode", () => {
    for (const risk of ["medium", "high"] as const) {
      expect(evaluateToolApproval({
        ...base,
        approvalMode: "risk_based",
        risk,
        capability: "read",
      }).requiresApproval).toBe(true);
    }
  });

  test("sensitive approval summaries are redacted", () => {
    expect(redactedArgumentSummary({
      apiKey: "secret-value",
      password: "pass",
      query: "safe",
      nested: { authorization: "Bearer secret" },
    })).toEqual({
      apiKey: "[redacted]",
      password: "[redacted]",
      query: "safe",
      nested: { authorization: "[redacted]" },
    });
  });
});

describe("runtime limits and observability safety", () => {
  test("configuration is clamped within production boundaries", () => {
    process.env.MAX_MODEL_STEPS_PER_RUN = "999";
    process.env.MAX_TOTAL_TOOL_CALLS_PER_RUN = "0";
    process.env.TOOL_APPROVAL_TTL_SECONDS = "10";
    process.env.RUN_CHECKPOINT_TTL_SECONDS = "99999999";
    expect(maxModelStepsPerRun()).toBe(16);
    expect(maxTotalToolCallsPerRun()).toBe(1);
    expect(toolApprovalTtlSeconds()).toBe(60);
    expect(runCheckpointTtlSeconds()).toBe(7 * 24 * 3600);
  });

  test("telemetry keeps token counts but drops secrets and content", () => {
    const fields = safeTelemetry({
      operation: "agent.model.step",
      inputTokens: 120,
      outputTokens: 50,
      apiKey: "secret",
      authorization: "Bearer secret",
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
      "browser-task-execute",
      "browser-task-resume",
      "document-parse",
      "execution-cancel",
      "execution-cleanup",
      "execution-collect-artifacts",
      "execution-expire",
      "execution-provision",
      "execution-reconcile",
      "execution-run-step",
      "notification-dispatch",
      "sandbox-artifact-cleanup",
      "sandbox-cleanup",
      "sandbox-create",
      "sandbox-execute",
      "sandbox-health-check",
      "sandbox-reset",
      "sandbox-resume",
      "telegram-update-process",
      "whatsapp-channel-update",
    ]);
    expect(Object.keys(taskList)).not.toContain("document-embed");
    expect(Object.keys(taskList)).not.toContain("memory-compact");
    expect(Object.keys(taskList)).not.toContain("evaluation-run");
    expect(Object.keys(taskList)).not.toContain("integration-sync");
  });
});
