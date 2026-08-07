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

  it("requires admin channel features for approvals runtimes and GitHub", () => {
    for (const actionId of ["cc.approvals", "cc.browser", "cc.sandbox", "cc.repos", "cc.repo:123"]) {
      const requirements = requiredChannelFeatures({
        channel: "whatsapp",
        session: { activeFlow: null } as never,
        incoming: { attachments: [] } as never,
        actionId,
        text: "",
      });
      expect(requirements).toContainEqual({
        key: "whatsapp.admin_commands",
        labelAr: "التكاملات وأوامر التشغيل الإدارية",
      });
    }
  });

  it("contains only capabilities backed by implemented shared handlers", async () => {
    const registry = await readFile("src/lib/channel-client/capability-registry.ts", "utf8");
    const runtime = await readFile("src/lib/channel-client/runtime.ts", "utf8");
    const operations = await readFile("src/lib/channel-client/operations-runtime.ts", "utf8");
    const integrationsRuntime = await readFile("src/lib/channel-client/integration-runtime.ts", "utf8");
    const services = await readFile("src/lib/channel-client/operations-service.ts", "utf8");
    const githubService = await readFile("src/lib/repositories/github-application-service.ts", "utf8");
    for (const capability of [
      "chat.start",
      "agents.list",
      "agents.create",
      "teams.list",
      "teams.run",
      "runs.list",
      "approvals.list",
      "files.receive",
      "repositories.list",
      "browser.list",
      "sandbox.list",
    ]) {
      expect(registry).toContain(`id: "${capability}"`);
    }
    expect(runtime).toContain("listAccessibleChannelAgents");
    expect(runtime).toContain("listVerifiedProviderOptions");
    expect(runtime).toContain("createAgentApplication");
    expect(runtime).toContain("routeIncomingChannelMessage");
    expect(operations).toContain("createChannelTeamRun");
    expect(operations).toContain("decideChannelApproval");
    expect(operations).toContain("channelBrowserDiagnostics");
    expect(operations).toContain("channelSandboxDiagnostics");
    expect(integrationsRuntime).toContain("listOrganizationGitHubRepositories");
    expect(integrationsRuntime).toContain("findOrganizationGitHubRepository");
    expect(githubService).toContain("decryptSecret");
    expect(githubService).toContain('permission: "integrations:read"');
    expect(services).toContain("testCurrentAuthenticatedRunner");
  });

  it("routes every visible Telegram runtime and integration button to a real handler", async () => {
    const menu = await readFile("src/lib/telegram/menu-renderer.ts", "utf8");
    const processor = await readFile("src/lib/telegram/update-processor.ts", "utf8");
    const runtime = await readFile("src/lib/telegram/runtime-flows.ts", "utf8");
    const repositories = await readFile("src/lib/telegram/repository-flows.ts", "utf8");
    for (const [capability, action] of [
      ["files.receive", "files:help"],
      ["repositories.list", "repositories:list"],
      ["browser.list", "browser:list"],
      ["sandbox.list", "sandbox:list"],
    ]) {
      expect(menu).toContain(`"${capability}": "${action}"`);
      expect(processor).toContain(`input.action === "${action}"`);
    }
    expect(processor).toContain("showTelegramRepository");
    expect(processor).toContain('new ApiError(403, "TELEGRAM_FILES_CAPABILITY_DENIED"');
    expect(runtime).toContain("channelBrowserDiagnostics");
    expect(runtime).toContain("channelSandboxDiagnostics");
    expect(repositories).toContain("listOrganizationGitHubRepositories");
    expect(repositories).toContain("findOrganizationGitHubRepository");
    expect(repositories).toContain("telegramPlatformConfig");
    expect(repositories).not.toContain("https://moatazalalqami.online");
  });

  it("uses one capability registry for Telegram and WhatsApp", async () => {
    const telegramRegistry = await readFile("src/lib/telegram/capability-registry.ts", "utf8");
    expect(telegramRegistry).toContain("CHANNEL_CAPABILITY_REGISTRY");
    expect(telegramRegistry).toContain("resolveChannelCapabilities");
    expect(telegramRegistry).not.toContain("platformModules");
    expect(telegramRegistry).not.toContain("loadCustomPermissions");
  });

  it("makes the dashboard repository API use the same application service as channels", async () => {
    const route = await readFile("src/app/api/dashboard/repositories/route.ts", "utf8");
    expect(route).toContain("listOrganizationGitHubRepositories");
    expect(route).toContain("readOrganizationGitHubContents");
    expect(route).not.toContain("decryptSecret");
    expect(route).not.toContain("listGitHubRepositories");
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

  it("routes WhatsApp integrations and operations through real shared runtimes", async () => {
    const processor = await readFile("src/lib/whatsapp/update-processor.ts", "utf8");
    expect(processor).toContain("processChannelIntegrations");
    expect(processor).toContain("processChannelOperations");
    expect(processor).toContain('"integrations.read"');
    expect(processor).toContain('"browser.read"');
    expect(processor).toContain('"sandbox.read"');
  });
});
