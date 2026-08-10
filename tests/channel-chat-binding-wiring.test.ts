import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("real external channel chat bindings", () => {
  it("keeps Telegram administration on the verified per-organization integration path", async () => {
    const route = await readFile("src/app/api/dashboard/channels/route.ts", "utf8");
    const integrationRoute = await readFile("src/app/api/dashboard/integrations/route.ts", "utf8");
    expect(route).not.toContain("centralTelegramBot");
    expect(route).not.toContain("ensureCentralTelegramChannelConnection");
    expect(integrationRoute).toContain("ensureTelegramChannelConnection");
    expect(integrationRoute).toContain("configureAndVerifyTelegramWebhook");
  });

  it("keeps the top-level channels page compact and health-focused", async () => {
    const component = await readFile("src/components/channel-manager.tsx", "utf8");
    const page = await readFile("src/app/dashboard/channels/page.tsx", "utf8");
    expect(component).toContain("/api/dashboard/channels?mode=summary");
    expect(component).toContain("اختبار الاتصال");
    expect(component).toContain("ربط تيليجرام");
    expect(component).toContain("ربط واتساب");
    expect(component).not.toContain("tools.execute");
    expect(page).not.toContain("providerCredentials");
    expect(page).not.toContain("mcpTools");
    expect(page).not.toContain("organizationMembers");
  });

  it("creates a real WhatsApp channel conversation instead of returning only a dashboard URL", async () => {
    const commands = await readFile("src/lib/integrations/whatsapp/commands.ts", "utf8");
    expect(commands).toContain("routeIncomingChannelMessage");
    expect(commands).toContain("ensureOrganizationWhatsAppProjection");
    expect(commands).toContain('interactiveActionId: "channel.new"');
    expect(commands).toContain('text: "/new"');
    expect(commands).not.toContain("/dashboard/chat`, previewUrl: true");
  });
});
