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

  it("requires administrative channel permission throughout agent creation", () => {
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

  it("contains only capabilities backed by implemented shared handlers", async () => {
    const registry = await readFile("src/lib/channel-client/capability-registry.ts", "utf8");
    const runtime = await readFile("src/lib/channel-client/runtime.ts", "utf8");
    expect(registry).toContain('id: "chat.start"');
    expect(registry).toContain('id: "agents.list"');
    expect(registry).toContain('id: "agents.create"');
    expect(registry).toContain('id: "files.receive"');
    expect(registry).not.toContain('id: "teams.list"');
    expect(registry).not.toContain('id: "repositories.list"');
    expect(runtime).toContain("listAccessibleChannelAgents");
    expect(runtime).toContain("listVerifiedProviderOptions");
    expect(runtime).toContain("createAgentApplication");
    expect(runtime).toContain("routeIncomingChannelMessage");
  });

  it("persists agent selection and never mutates a shared channel connection", async () => {
    const runtime = await readFile("src/lib/channel-client/runtime.ts", "utf8");
    expect(runtime).toContain("selectChannelAgent");
    expect(runtime).toContain("selectedConversationId: result.conversationId");
    expect(runtime).toContain("defaultAgentId: agent.id");
    expect(runtime).not.toContain("update(channelConnections)");
  });

  it("queues both webhooks before heavy channel or AI processing", async () => {
    const telegram = await readFile("src/app/api/webhooks/telegram/route.ts", "utf8");
    const whatsapp = await readFile("src/app/api/webhooks/whatsapp/route.ts", "utf8");
    expect(telegram).toContain("enqueueTelegramCentralUpdate");
    expect(telegram).not.toContain("routeIncomingChannelMessage");
    expect(whatsapp).toContain("enqueueWhatsAppChannelUpdate");
    expect(whatsapp).not.toContain("routeIncomingChannelMessage");
  });
});
