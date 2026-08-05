import { describe, expect, it } from "vitest";
import {
  channelPolicyForWhatsApp,
  connectionForWhatsAppPolicy,
} from "@/lib/channels/whatsapp-platform";

describe("central WhatsApp policy", () => {
  const policy = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    agentId: "00000000-0000-4000-8000-000000000003",
    providerCredentialId: "00000000-0000-4000-8000-000000000004",
    modelId: "model-x",
    teamId: null,
    inboxId: null,
    workflowId: null,
    allowedTools: ["00000000-0000-4000-8000-000000000005"],
    allowedActions: ["search"],
    permissions: ["ai.chat", "agent.use", "tools.execute"] as const,
    monthlyLimit: 25,
    autoReplyEnabled: true,
    humanHandoffEnabled: true,
    memoryEnabled: false,
    filesEnabled: false,
    status: "active" as const,
    forceHumanHandoff: false,
  };

  it("routes through the assigned agent/provider/model without mutating the stored connection", () => {
    const stored = {
      defaultAgentId: null,
      defaultProviderCredentialId: null,
      defaultModel: null,
      inboxId: null,
      workflowId: null,
      enabled: true,
      status: "healthy",
      settings: { handoffMode: "ai" as const, historyEnabled: true },
    };
    const routed = connectionForWhatsAppPolicy(stored, policy);
    expect(routed.defaultAgentId).toBe(policy.agentId);
    expect(routed.defaultProviderCredentialId).toBe(policy.providerCredentialId);
    expect(routed.defaultModel).toBe(policy.modelId);
    expect(routed.settings.monthlyMessageLimit).toBe(25);
    expect(stored.defaultAgentId).toBeNull();
  });

  it("exposes only explicitly permitted tools and blocks sensitive operations by default", () => {
    const routing = channelPolicyForWhatsApp("connection", policy);
    expect(routing.allowedToolIds).toEqual(policy.allowedTools);
    expect(routing.permissions.has("tools.execute")).toBe(true);
    expect(routing.permissions.has("files.use")).toBe(false);
    expect(routing.blockedOperations).toEqual(new Set(["financial", "sensitive"]));
  });

  it("removes all tools when tools.execute is absent", () => {
    const routing = channelPolicyForWhatsApp("connection", {
      ...policy,
      permissions: ["ai.chat", "agent.use"],
    });
    expect(routing.allowedToolIds).toEqual([]);
  });

  it("turns a forced handoff policy into human mode", () => {
    const routed = connectionForWhatsAppPolicy({
      defaultAgentId: null,
      defaultProviderCredentialId: null,
      defaultModel: null,
      inboxId: null,
      workflowId: null,
      enabled: true,
      status: "healthy",
      settings: { handoffMode: "ai" as const },
    }, { ...policy, forceHumanHandoff: true });
    expect(routed.settings.handoffMode).toBe("human");
  });
});
