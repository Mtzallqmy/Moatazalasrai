import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sendInteractiveButtons, sendTextMessage, WhatsAppApiError } from "@/lib/integrations/whatsapp/client";
import { parseWhatsAppCommand, WHATSAPP_COMMAND_IDS } from "@/lib/integrations/whatsapp/commands";
import {
  hashWhatsAppConnectToken,
  maskWhatsAppId,
  verifyMetaWebhookSignature,
} from "@/lib/integrations/whatsapp/crypto";
import { buildWhatsAppConnectUrl } from "@/lib/integrations/whatsapp/linking";
import { extractWhatsAppMessages } from "@/lib/integrations/whatsapp/webhook";

const config = {
  appId: "123456",
  appSecret: "0123456789abcdef0123456789abcdef",
  graphApiVersion: "v23.0",
  accessToken: "test-access-token-that-is-long-enough",
  phoneNumberId: "1234567890",
  businessAccountId: "9876543210",
  displayPhoneNumber: "967700000000",
  webhookVerifyToken: "verify-token-123456",
  connectTokenSecret: "connect-token-secret-32-characters-minimum",
  connectTokenTtlMinutes: 10,
  publicAppUrl: "https://app.example",
};

describe("WhatsApp Business Platform primitives", () => {
  it("stores a deterministic HMAC instead of the raw connect token", () => {
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG1234567890_-";
    const digest = hashWhatsAppConnectToken(token, config.connectTokenSecret);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(hashWhatsAppConnectToken(token, config.connectTokenSecret)).toBe(digest);
  });

  it("builds a wa.me URL with an encoded CONNECT message", () => {
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFG1234567890_-";
    const url = new URL(buildWhatsAppConnectUrl("+967 700 000 000", token));
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/967700000000");
    expect(url.searchParams.get("text")).toBe(`CONNECT ${token}`);
  });

  it("validates X-Hub-Signature-256 against the exact raw body", () => {
    const raw = '{"object":"whatsapp_business_account"}';
    const signature = `sha256=${createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
    expect(verifyMetaWebhookSignature(raw, signature, config.appSecret)).toBe(true);
    expect(verifyMetaWebhookSignature(`${raw} `, signature, config.appSecret)).toBe(false);
    expect(verifyMetaWebhookSignature(raw, "sha256=invalid", config.appSecret)).toBe(false);
  });

  it("extracts all messages from entry and changes arrays and ignores status-only changes", () => {
    const messages = extractWhatsAppMessages({
      entry: [
        { changes: [
          { value: { metadata: { phone_number_id: "123" }, statuses: [{ id: "status" }] } },
          { value: { metadata: { phone_number_id: "123" }, messages: [
            { id: "wamid.1", from: "967711111111", type: "text", text: { body: "القائمة" } },
            { id: "wamid.2", from: "967722222222", type: "interactive", interactive: { button_reply: { id: WHATSAPP_COMMAND_IDS.account } } },
          ] } },
        ] },
        { changes: [{ value: { messages: [{ id: "wamid.3", from: "967733333333", type: "image" }] } }] },
      ],
    });
    expect(messages.map((item) => item.message.id)).toEqual(["wamid.1", "wamid.2", "wamid.3"]);
    expect(messages[0]?.phoneNumberId).toBe("123");
  });

  it("routes fixed interactive IDs instead of visible button text", () => {
    expect(parseWhatsAppCommand({
      id: "1", from: "967700000000", type: "interactive",
      interactive: { button_reply: { id: WHATSAPP_COMMAND_IDS.disconnect, title: "أي نص" } },
    })).toEqual({ kind: "disconnect" });
    expect(parseWhatsAppCommand({
      id: "2", from: "967700000000", type: "text", text: { body: "القائمة" },
    })).toEqual({ kind: "menu" });
  });

  it("masks the WhatsApp ID before returning display data", () => {
    expect(maskWhatsAppId("+967-711-234-567")).toBe("••••••4567");
  });
});

describe("official WhatsApp Cloud API client", () => {
  it("sends text through the official Graph messages endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await sendTextMessage({ to: "967711111111", text: "مرحبا", config, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v23.0/1234567890/messages");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${config.accessToken}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "967711111111",
      type: "text",
    });
  });

  it("uses stable IDs and at most three official reply buttons", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.buttons" }] }), { status: 200 }));
    await sendInteractiveButtons({
      to: "967711111111",
      bodyText: "اختر",
      buttons: [
        { id: WHATSAPP_COMMAND_IDS.account, title: "حسابي" },
        { id: WHATSAPP_COMMAND_IDS.openChat, title: "فتح الدردشة" },
      ],
      config,
      fetchImpl,
    });
    const payload = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(payload.interactive.action.buttons[0].reply.id).toBe(WHATSAPP_COMMAND_IDS.account);
  });

  it("does not claim success for a malformed HTTP 200 response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(sendTextMessage({ to: "967711111111", text: "test", config, fetchImpl }))
      .rejects.toMatchObject({ code: "WHATSAPP_API_INVALID_RESPONSE", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry permanent authentication failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 190, type: "OAuthException", fbtrace_id: "trace" },
    }), { status: 401 }));
    await expect(sendTextMessage({ to: "967711111111", text: "test", config, fetchImpl }))
      .rejects.toBeInstanceOf(WhatsAppApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx response with a strict attempt limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 2 } }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "wamid.retry" }] }), { status: 200 }));
    await sendTextMessage({ to: "967711111111", text: "test", config, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
