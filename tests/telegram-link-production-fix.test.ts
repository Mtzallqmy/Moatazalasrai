import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Telegram production linking", () => {
  it("creates a link code and navigates the same tab directly to the bot with an app fallback", async () => {
    const component = await readFile("src/components/central-telegram-manager.tsx", "utf8");
    expect(component).toContain("createCodeAndOpenBot");
    expect(component).toContain("window.location.href = nextCode.deepLink");
    expect(component).toContain("nextCode.appDeepLink");
    expect(component).toContain("إنشاء رمز وفتح البوت");
    expect(component).toContain("فتح تطبيق Telegram");
    expect(component).toContain("setCode(null)");
    expect(component).not.toContain('target="_blank"');
  });

  it("verifies schema and registers webhook commands before the web process starts", async () => {
    const startup = await readFile("scripts/start-production.mjs", "utf8");
    const setup = await readFile("scripts/setup-telegram-webhook.mjs", "utf8");
    const schema = await readFile("scripts/check-telegram-schema.mjs", "utf8");
    expect(startup).toContain("telegram.schema.verification");
    expect(startup).toContain("telegram.webhook.bootstrap");
    expect(startup).toContain("process.exit(1)");
    expect(startup.indexOf("telegram.webhook.bootstrap")).toBeLessThan(startup.indexOf("const next = spawn"));
    expect(schema).toContain("0039_central_telegram_bot.sql");
    expect(schema).toContain("telegram_account_links");
    expect(setup).toContain('call("setWebhook"');
    expect(setup).toContain('call("setMyCommands"');
    expect(setup).toContain('call("getWebhookInfo"');
    expect(setup).toContain("pending_update_count");
    expect(setup).toContain("last_error_message");
    expect(setup).toContain('["message", "edited_message", "callback_query"]');
  });

  it("validates all central bot secrets before the web process starts", async () => {
    const validation = await readFile("scripts/validate-runtime-env.mjs", "utf8");
    expect(validation).toContain('enabled("TELEGRAM_INTEGRATION_ENABLED")');
    expect(validation).toContain('"TELEGRAM_BOT_TOKEN"');
    expect(validation).toContain('"TELEGRAM_WEBHOOK_SECRET"');
    expect(validation).toContain('"TELEGRAM_LINK_CODE_SECRET"');
  });
});
