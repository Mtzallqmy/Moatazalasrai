import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { deniedChannelFeature, requiredChannelFeatures } from "@/lib/channel-client/feature-guard";
import { normalizeChannelClientView, sendChannelClientView } from "@/lib/channel-client/message-renderer";

describe("shared channel client runtime", () => {
  it("rejects empty messages instead of calling a channel API", async () => {
    const send = vi.fn(async () => undefined);
    await expect(sendChannelClientView({ send }, { text: "   " })).rejects.toMatchObject({
      code: "CHANNEL_EMPTY_MESSAGE",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects callback identifiers beyond Telegram limits", () => {
    expect(() => normalizeChannelClientView({
      text: "رسالة صالحة",
      actions: [[{ id: "x".repeat(65), title: "إجراء" }]],
    })).toThrowError(expect.objectContaining({ code: "CHANNEL_CALLBACK_TOO_LONG" }));
  });

  it("requires real media and chat features before worker processing", async () => {
    const requirements = requiredChannelFeatures({
      channel: "telegram",
      session: { activeFlow: "chat" } as never,
      incoming: { attachments: [{ kind: "image" }] } as never,
      text: "حلل الصورة",
    });
    expect(requirements).toEqual(expect.arrayContaining([
      { key: "telegram.images", labelAr: "الصور" },
      { key: "telegram.chat", labelAr: "الدردشة" },
    ]));
    const denied = await deniedChannelFeature({
      requirements,
      featureAllowed: async (key) => key !== "telegram.images",
    });
    expect(denied).toEqual({ key: "telegram.images", labelAr: "الصور" });
  });

  it("requires administrative permission throughout agent creation", () => {
    const requirements = requiredChannelFeatures({
      channel: "whatsapp",
      session: { activeFlow: "agent.create" } as never,
      incoming: { attachments: [] } as never,
      actionId: "cc.agent.confirm",
      text: "",
    });
    expect(requirements).toContainEqual({
      key: "whatsapp.admin_commands",
      labelAr: "إنشاء وإدارة الوكلاء",
    });
  });

  it("requires agent features for real team runs and admin features for approvals and runtimes", () => {
    const team = requiredChannelFeatures({
      channel: "whatsapp",
      session: { activeFlow: "team.run" } as never,
      incoming: { attachments: [] } as never,
      actionId: "cc.teamrun.confirm",
      text: "",
    });
    expect(team).toContainEqual({
      key: "whatsapp.agents",
      labelAr: "فرق الوكلاء وعمليات التشغيل",
    });

    const approval = requiredChannelFeatures({
      channel: "whatsapp",
      session: { activeFlow: null } as never,
      incoming: { attachments: [] } as never,
      actionId: "cc.approvals",
      text: "",
    });
    expect(approval).toContainEqual({
      key: "whatsapp.admin_commands",
      labelAr: "أوامر التشغيل الإدارية",
    });
  });

  it("contains only capabilities backed by implemented shared handlers", async () => {
    const registry = await readFile("src/lib/channel-client/capability-registry.ts", "utf8");
    const runtime = await readFile("src/lib/channel-client/runtime.ts", "utf8");
    const operations = await readFile("src/lib/channel-client/operations-runtime.ts", "utf8");
    const services = await readFile("src/lib/channel-client/operations-service.ts", "utf8");
    for (const capability of [
      "chat.start",
      "agents.list",
      "agents.create",
      "teams.list",
      "teams.run",
      "runs.list",
      "approvals.list",
      "files.receive",
      "browser.list",
      "sandbox.list",
    ]) {
      expect(registry).toContain(`id: "${capability}"`);
    }
    expect(registry).not.toContain('id: "repositories.list"');
    expect(runtime).toContain("listAccessibleChannelAgents");
    expect(runtime).toContain("listVerifiedProviderOptions");
    expect(runtime).toContain("createAgentApplication");
    expect(runtime).toContain("routeIncomingChannelMessage");
    expect(operations).toContain("createChannelTeamRun");
    expect(operations).toContain("decideChannelApproval");
    expect(operations).toContain("channelBrowserDiagnostics");
    expect(operations).toContain("channelSandboxDiagnostics");
    expect(services).toContain("createAgentTeamRun");
    expect(services).toContain("listPendingToolApprovals");
    expect(services).toContain("listBrowserTasks");
    expect(services).toContain("listSandboxExecutions");
  });

  it("persists agent selection and never mutates the shared channel connection", async () => {
    const runtime = await readFile("src/lib/channel-client/runtime.ts", "utf8");
    expect(runtime).toContain("selectChannelAgent");
    expect(runtime).toContain("selectedConversationId: result.conversationId");
    expect(runtime).not.toContain("update(channelConnections)");
  });

  it("queues both webhooks before heavy channel or AI processing", async () => {
    const telegram = await readFile("src/app/api/webhooks/telegram/route.ts", "utf8");
    const whatsapp = await readFile("src/app/api/webhooks/whatsapp/route.ts", "utf8");
    expect(telegram).toContain("enqueueTelegramUpdate");
    expect(telegram).not.toContain("routeIncomingChannelMessage");
    expect(whatsapp).toContain("enqueueWhatsAppChannelUpdate");
    expect(whatsapp).not.toContain("routeIncomingChannelMessage");
  });

  it("routes WhatsApp operational commands through the shared real runtime", async () => {
    const processor = await readFile("src/lib/whatsapp/update-processor.ts", "utf8");
    expect(processor).toContain("processChannelOperations");
    expect(processor).toContain('actionId: "cc.home"');
    expect(processor).toContain('"runs.manage"');
    expect(processor).toContain('"approvals.manage"');
    expect(processor).toContain('"browser.read"');
    expect(processor).toContain('"sandbox.read"');
  });
});
