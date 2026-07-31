import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { integrationUpdateSchema } from "@/lib/http/contracts";

const integrationId = "00000000-0000-4000-8000-000000000001";
const agentId = "00000000-0000-4000-8000-000000000002";

describe("integration agent binding", () => {
  it("accepts reassignment and explicit unbinding", () => {
    expect(integrationUpdateSchema.parse({ id: integrationId, agentId }).agentId).toBe(agentId);
    expect(integrationUpdateSchema.parse({ id: integrationId, agentId: null }).agentId).toBeNull();
  });

  it("keeps tenant validation and audit logging in the backend", async () => {
    const route = await readFile("src/app/api/dashboard/integrations/route.ts", "utf8");
    expect(route).toContain("eq(agents.organizationId, organizationId)");
    expect(route).toContain('eq(agents.status, "published")');
    expect(route).toContain('"integration.agent_changed"');
    expect(route).toContain("previousAgentId");
    expect(route).toContain("db().transaction");
  });

  it("offers a real Telegram agent selector and preserves historical conversations", async () => {
    const component = await readFile("src/components/integrations-manager.tsx", "utf8");
    const webhook = await readFile("src/app/api/webhooks/telegram/[integrationId]/route.ts", "utf8");
    expect(component).toContain("الوكيل المرتبط بهذا البوت");
    expect(component).toContain("agentId: event.target.value || null");
    expect(webhook).toContain("existing.agentId === input.agentId");
    expect(webhook).toContain("conversationId: conversation.id");
  });
});
