import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { integrationUpdateSchema } from "@/lib/http/contracts";

const integrationId = "00000000-0000-4000-8000-000000000001";
const agentId = "00000000-0000-4000-8000-000000000002";

describe("integration agent binding", () => {
  it("keeps the legacy schema compatible for historical Telegram records", () => {
    expect(integrationUpdateSchema.parse({ id: integrationId, agentId }).agentId).toBe(agentId);
    expect(integrationUpdateSchema.parse({ id: integrationId, agentId: null }).agentId).toBeNull();
  });

  it("rejects new tenant Telegram tokens while preserving audited GitHub mutations", async () => {
    const route = await readFile("src/app/api/dashboard/integrations/route.ts", "utf8");
    expect(route).toContain("TELEGRAM_CENTRAL_BOT_ONLY");
    expect(route).toContain("assertTelegramUserTokensAllowed(body.kind)");
    expect(route).toContain("db().transaction");
    expect(route).toContain('action: "integration.created"');
  });

  it("routes the central Telegram bot through the queued processor and shared platform services", async () => {
    const component = await readFile("src/components/central-telegram-manager.tsx", "utf8");
    const webhook = await readFile("src/app/api/webhooks/telegram/route.ts", "utf8");
    const processor = await readFile("src/lib/telegram/update-processor.ts", "utf8");
    const conversations = await readFile("src/lib/telegram/conversation-flows.ts", "utf8");
    const router = await readFile("src/lib/channels/router.ts", "utf8");

    expect(component).toContain("إنشاء رمز وفتح البوت");
    expect(component).toContain("فتح البوت مباشرة");
    expect(component).toContain("window.location.href = nextCode.deepLink");
    expect(component).toContain("nextCode.appDeepLink");
    expect(component).toContain('window.addEventListener("pageshow", synchronize)');

    expect(webhook).toContain("enqueueTelegramUpdate");
    expect(webhook).not.toContain("executeAgentRun");
    expect(processor).toContain("resolveTelegramAccount");
    expect(processor).toContain("ensureTelegramSession");
    expect(processor).toContain("sendTelegramConversationMessage");
    expect(conversations).toContain("createConversationForAgent");
    expect(conversations).toContain("executeAgentRun");
    expect(router).toContain("channelConversationLinks");
    expect(router).toContain("conversationId: conversation.id");
  });
});
