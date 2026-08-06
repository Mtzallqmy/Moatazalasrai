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

  it("verifies shared client schemas and registers implemented commands before the web process starts", async () => {
    const startup = await readFile("scripts/start-production.mjs", "utf8");
    const setup = await readFile("scripts/setup-telegram-webhook.mjs", "utf8");
    const schema = await readFile("scripts/check-telegram-schema.mjs", "utf8");
    expect(startup).toContain("channel.client.schema.verification");
    expect(startup).toContain("telegram.webhook.bootstrap");
    expect(startup).toContain("process.exit(1)");
    expect(startup.indexOf("channel.client.schema.verification")).toBeLessThan(startup.indexOf("const next = spawn"));
    expect(schema).toContain("0039_central_telegram_bot.sql");
    expect(schema).toContain("0041_channel_client_sessions.sql");
    expect(schema).toContain("telegram_user_sessions");
    expect(schema).toContain("whatsapp_user_sessions");
    expect(setup).toContain('call("setWebhook"');
    expect(setup).toContain('call("setMyCommands"');
    expect(setup).toContain('call("getWebhookInfo"');
    expect(setup).toContain("pending_update_count");
    expect(setup).toContain("last_error_message");
    for (const update of ["message", "edited_message", "callback_query", "my_chat_member"]) {
      expect(setup).toContain(`"${update}"`);
    }
  });

  it("validates all central bot secrets before the web process starts", async () => {
    const validation = await readFile("scripts/validate-runtime-env.mjs", "utf8");
    expect(validation).toContain('enabled("TELEGRAM_INTEGRATION_ENABLED")');
    expect(validation).toContain('"TELEGRAM_BOT_TOKEN"');
    expect(validation).toContain('"TELEGRAM_WEBHOOK_SECRET"');
    expect(validation).toContain('"TELEGRAM_LINK_CODE_SECRET"');
  });
});
