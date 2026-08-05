import { describe, expect, it, vi } from "vitest";
import { evaluateFeatureRollout } from "@/lib/control-plane/features";
import { sendWhatsAppTemplate } from "@/lib/integrations/whatsapp/template-client";
import { renderNotificationTemplate, templateVariables } from "@/lib/notifications/render";

const whatsappConfig = {
  appId: "app",
  appSecret: "secret",
  graphApiVersion: "v23.0",
  accessToken: "token",
  phoneNumberId: "123456789",
  businessAccountId: "987654321",
  displayPhoneNumber: "+967700000000",
  webhookVerifyToken: "verify",
  connectTokenSecret: "connect",
  connectTokenTtlMinutes: 15,
  publicAppUrl: "https://example.com",
};

describe("platform control plane foundation", () => {
  it("fails closed for disabled feature flags", () => {
    expect(evaluateFeatureRollout({ enabled: false, rolloutPercentage: 100, subject: "user-1" })).toBe(false);
    expect(evaluateFeatureRollout({ enabled: true, rolloutPercentage: 0, subject: "user-1" })).toBe(false);
  });

  it("evaluates partial rollout deterministically", () => {
    const first = evaluateFeatureRollout({ enabled: true, rolloutPercentage: 35, subject: "user-42" });
    const second = evaluateFeatureRollout({ enabled: true, rolloutPercentage: 35, subject: "user-42" });
    expect(first).toBe(second);
  });

  it("renders declared nested variables and rejects missing data", () => {
    const template = "مرحبًا {{user.name}}، طلبك {{order.id}} حالته {{order.status}}";
    expect(templateVariables(template)).toEqual(["user.name", "order.id", "order.status"]);
    expect(renderNotificationTemplate(template, {
      user: { name: "معتز" },
      order: { id: 17, status: "جديد" },
    }, ["user.name", "order.id", "order.status"])).toBe("مرحبًا معتز، طلبك 17 حالته جديد");
    expect(() => renderNotificationTemplate("{{missing}}", {}, ["missing"]))
      .toThrow("NOTIFICATION_VARIABLE_MISSING:missing");
  });

  it("sends an approved WhatsApp template with ordered parameters", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.type).toBe("template");
      expect(payload.template.name).toBe("order_created");
      expect(payload.template.components[0].parameters.map((item: { text: string }) => item.text))
        .toEqual(["معتز", "ORD-10", "جديد"]);
      return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(sendWhatsAppTemplate({
      to: "+967700000000",
      templateName: "order_created",
      languageCode: "ar",
      parameters: ["معتز", "ORD-10", "جديد"],
      config: whatsappConfig,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual({ messageId: "wamid.test" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
