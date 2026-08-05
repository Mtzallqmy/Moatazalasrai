import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashTelegramLinkCode,
  telegramPlatformConfig,
  TELEGRAM_FEATURE_KEYS,
  verifyTelegramWebhookSecret,
} from "@/lib/integrations/telegram-platform";
import { resetEnvForTests } from "@/lib/config/env";

const managed = [
  "NODE_ENV", "APP_URL", "PUBLIC_APP_URL", "TELEGRAM_INTEGRATION_ENABLED", "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_LINK_CODE_SECRET",
  "TELEGRAM_LINK_CODE_TTL_MINUTES", "TELEGRAM_LINK_CODE_MAX_ATTEMPTS", "TELEGRAM_LINK_CODE_LENGTH",
  "TELEGRAM_ALLOW_USER_BOT_TOKENS", "TELEGRAM_UPDATE_MODE", "TELEGRAM_WEBHOOK_MAX_BYTES",
] as const;
const original = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of managed) original.set(key, process.env[key]);
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL: "https://app.example",
    TELEGRAM_INTEGRATION_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "123456789:central-test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret-at-least-16",
    TELEGRAM_LINK_CODE_SECRET: "link-code-secret-at-least-32-characters-long",
  });
  resetEnvForTests();
});

afterEach(() => {
  for (const key of managed) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  original.clear();
  resetEnvForTests();
});

describe("central Telegram platform configuration", () => {
  it("uses secure defaults and derives the central webhook URL", () => {
    const config = telegramPlatformConfig();
    expect(config.webhookUrl).toBe("https://app.example/api/webhooks/telegram");
    expect(config.linkCodeLength).toBe(6);
    expect(config.linkCodeTtlMinutes).toBe(10);
    expect(config.linkCodeMaxAttempts).toBe(5);
    expect(config.allowUserBotTokens).toBe(false);
    expect(config.webhookMaxBytes).toBe(1_048_576);
  });

  it("compares webhook secrets without accepting missing or wrong values", () => {
    expect(verifyTelegramWebhookSecret(null)).toBe(false);
    expect(verifyTelegramWebhookSecret("wrong-secret-value")).toBe(false);
    expect(verifyTelegramWebhookSecret("webhook-secret-at-least-16")).toBe(true);
  });

  it("stores only an HMAC representation of a link code", () => {
    const first = hashTelegramLinkCode("123456");
    const second = hashTelegramLinkCode("123456");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
    expect(first).not.toContain("123456");
  });

  it("requires all central secrets when enabled", () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(() => telegramPlatformConfig()).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it("rejects non-HTTPS production URLs", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "http://app.example";
    expect(() => telegramPlatformConfig()).toThrow(/HTTPS/);
  });

  it("publishes the complete fail-closed feature catalog", () => {
    expect(TELEGRAM_FEATURE_KEYS).toEqual([
      "telegram.chat", "telegram.agents", "telegram.files", "telegram.images", "telegram.audio",
      "telegram.video", "telegram.notifications", "telegram.admin_commands",
    ]);
  });
});
