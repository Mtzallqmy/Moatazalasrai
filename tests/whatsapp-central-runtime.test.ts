import { describe, expect, it } from "vitest";
import {
  requireWhatsAppText,
  splitWhatsAppText,
  WhatsAppRenderError,
} from "@/lib/whatsapp/message-renderer";
import { parseWhatsAppUpdate } from "@/lib/whatsapp/update-parser";

describe("central WhatsApp renderer", () => {
  it("rejects empty and whitespace-only messages", () => {
    expect(() => requireWhatsAppText("   \n\t  ")).toThrowError(WhatsAppRenderError);
    expect(() => requireWhatsAppText(undefined)).toThrowError("رفض Renderer إرسال رسالة WhatsApp فارغة");
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
