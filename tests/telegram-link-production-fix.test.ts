import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Telegram production linking", () => {
  it("creates a link code and navigates the same tab directly to the bot", async () => {
    const component = await readFile("src/components/central-telegram-manager.tsx", "utf8");
    expect(component).toContain("createCodeAndOpenBot");
    expect(component).toContain("window.location.assign(nextCode.deepLink)");
    expect(component).toContain("إنشاء رمز وفتح البوت");
    expect(component).toContain("فتح البوت مباشرة");
    expect(component).not.toContain('target="_blank"');
  });

  it("reapplies and verifies the Telegram webhook on every production start", async () => {
    const startup = await readFile("scripts/start-production.mjs", "utf8");
    const setup = await readFile("scripts/setup-telegram-webhook.mjs", "utf8");
    expect(startup).toContain("bootstrapTelegramWebhook");
    expect(startup).toContain("scripts/setup-telegram-webhook.mjs");
    expect(startup).toContain("telegram.webhook.bootstrap.failed");
    expect(setup).toContain('call("setWebhook"');
    expect(setup).toContain('call("getWebhookInfo"');
    expect(setup).toContain("last_error_message");
    expect(setup).toContain('allowed_updates: ["message", "callback_query"]');
  });

  it("validates all central bot secrets before the web process starts", async () => {
    const validation = await readFile("scripts/validate-runtime-env.mjs", "utf8");
    expect(validation).toContain('enabled("TELEGRAM_INTEGRATION_ENABLED")');
    expect(validation).toContain('"TELEGRAM_BOT_TOKEN"');
    expect(validation).toContain('"TELEGRAM_WEBHOOK_SECRET"');
    expect(validation).toContain('"TELEGRAM_LINK_CODE_SECRET"');
  });
});
