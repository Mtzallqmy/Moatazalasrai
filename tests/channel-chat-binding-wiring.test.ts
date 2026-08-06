import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("real external channel chat bindings", () => {
  it("synchronizes the central Telegram projection before channel administration is listed", async () => {
    const route = await readFile("src/app/api/dashboard/channels/route.ts", "utf8");
    expect(route).toContain("centralTelegramBot");
    expect(route).toContain("ensureCentralTelegramChannelConnection");
    expect(route).toContain("synchronizeManagedChannels");
    expect(route).toContain("listChannelAdministration");
  });

  it("persists agent provider model tool and permission bindings from the channel editor", async () => {
    const component = await readFile("src/components/channel-manager.tsx", "utf8");
    expect(component).toContain('requestJson("/api/dashboard/channels", "PATCH"');
    expect(component).toContain('requestJson("/api/dashboard/channels/bindings", "PUT"');
    expect(component).toContain('requestJson("/api/dashboard/channels/permissions", "PUT"');
    expect(component).toContain("defaultProviderCredentialId");
    expect(component).toContain("toolIds");
    expect(component).toContain("tools.execute");
    expect(component).toContain("تم حفظ القناة وربط الوكيل والمزود والنموذج والأدوات والصلاحيات فعليًا");
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
