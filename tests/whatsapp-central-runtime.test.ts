import { describe, expect, it, vi } from "vitest";
import { sendTextMessage } from "@/lib/integrations/whatsapp/client";
import {
  requireWhatsAppText,
  splitWhatsAppText,
  WhatsAppRenderError,
} from "@/lib/whatsapp/message-renderer";
import { parseWhatsAppUpdate } from "@/lib/whatsapp/update-parser";

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

describe("central WhatsApp renderer", () => {
  it("rejects empty and whitespace-only messages", () => {
    expect(() => requireWhatsAppText("   \n\t  ")).toThrowError(WhatsAppRenderError);
    expect(() => requireWhatsAppText(undefined)).toThrowError("رفض Renderer إرسال رسالة WhatsApp فارغة");
  });

  it("rejects empty text inside the only Cloud API client before any network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(sendTextMessage({
      to: "967711111111",
      text: " \n ",
      config,
      fetchImpl,
    })).rejects.toMatchObject({ code: "WHATSAPP_EMPTY_TEXT", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("splits long responses into non-empty messages within WhatsApp limits", () => {
    const chunks = splitWhatsAppText(Array.from({ length: 900 }, (_, index) => `فقرة ${index}`).join("\n"));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.trim().length > 0 && chunk.length <= 4096)).toBe(true);
    expect(chunks.join("\n")).toContain("فقرة 899");
  });
});

describe("central WhatsApp update parser", () => {
  it("keeps an ordinary agent name as flow text instead of interpreting it as cancel", () => {
    expect(parseWhatsAppUpdate({
      id: "wamid.agent-name",
      from: "967711111111",
      type: "text",
      text: { body: "مساعد المحتوى" },
    })).toEqual({ kind: "text", text: "مساعد المحتوى" });
  });

  it("uses stable interactive action IDs rather than visible labels", () => {
    expect(parseWhatsAppUpdate({
      id: "wamid.action",
      from: "967711111111",
      type: "interactive",
      interactive: { button_reply: { id: "wa.agents.create", title: "أي عنوان" } },
    })).toEqual({ kind: "action", actionId: "wa.agents.create" });
  });

  it("recognizes explicit cancel only", () => {
    expect(parseWhatsAppUpdate({
      id: "wamid.cancel",
      from: "967711111111",
      type: "text",
      text: { body: "إلغاء" },
    })).toEqual({ kind: "action", actionId: "wa.cancel" });
  });
});
