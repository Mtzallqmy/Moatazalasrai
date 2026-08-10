import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { integrationUpdateSchema } from "@/lib/http/contracts";

const integrationId = "00000000-0000-4000-8000-000000000001";
const agentId = "00000000-0000-4000-8000-000000000002";

describe("integration agent binding", () => {
  it("keeps the integration schema compatible with Telegram agent binding", () => {
    expect(integrationUpdateSchema.parse({ id: integrationId, agentId }).agentId).toBe(agentId);
    expect(integrationUpdateSchema.parse({ id: integrationId, agentId: null }).agentId).toBeNull();
  });

  it("supports tenant Telegram tokens with verified webhooks and audited mutations", async () => {
    const route = await readFile("src/app/api/dashboard/integrations/route.ts", "utf8");
    const webhook = await readFile("src/app/api/webhooks/telegram/[integrationId]/route.ts", "utf8");
    const processor = await readFile("src/lib/telegram/channel-update-processor.ts", "utf8");

    expect(route).toContain("configureAndVerifyTelegramWebhook");
    expect(route).toContain("webhookSecretHash: hashApiKey(secret)");
    expect(route).toContain("webhookActive: true");
    expect(route).toContain("db().transaction");
    expect(route).toContain('action: "integration.created"');
    expect(webhook).toContain("enqueueTelegramUpdate");
    expect(webhook).toContain("integrationId: integration.id");
    expect(webhook).toContain("organizationId: integration.organizationId");
    expect(processor).toContain("routeIncomingChannelMessage");
    expect(processor).toContain("decryptSecret");
  });


});
