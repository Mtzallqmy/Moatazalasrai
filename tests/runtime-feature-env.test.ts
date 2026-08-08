import { afterEach, describe, expect, it } from "vitest";
import { validateOptionalRuntimeEnvironment } from "../scripts/validate-runtime-env.mjs";

const keys = [
  "TURNSTILE_ENABLED", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_EXPECTED_HOSTNAME",
  "OBJECT_STORAGE_DRIVER", "R2_ACCOUNT_ID", "R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
  "CLOUDFLARE_AI_GATEWAY_ENABLED", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_GATEWAY_ID", "CLOUDFLARE_AI_GATEWAY_TOKEN", "CLOUDFLARE_API_TOKEN",
  "AI_PROVIDER_FALLBACK_ENABLED", "AI_PROVIDER_DIRECT_FALLBACK_ENABLED",
  "WHATSAPP_INTEGRATION_ENABLED", "META_APP_ID", "META_APP_SECRET", "META_GRAPH_API_VERSION",
  "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_DISPLAY_PHONE_NUMBER", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_CONNECT_TOKEN_SECRET",
  "WHATSAPP_CONNECT_TOKEN_TTL_MINUTES", "PUBLIC_APP_URL", "APP_URL",
] as const;

afterEach(() => { for (const key of keys) delete process.env[key]; });

describe("optional production feature configuration", () => {
  it("allows all Cloudflare features to remain disabled", () => {
    expect(() => validateOptionalRuntimeEnvironment()).not.toThrow();
  });

  it("fails fast when Turnstile is enabled without server credentials", () => {
    process.env.TURNSTILE_ENABLED = "true";
    expect(() => validateOptionalRuntimeEnvironment()).toThrow("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  });

  it("fails fast when R2 has incomplete bucket credentials", () => {
    process.env.OBJECT_STORAGE_DRIVER = "r2";
    process.env.R2_ACCOUNT_ID = "account";
    expect(() => validateOptionalRuntimeEnvironment()).toThrow("R2_BUCKET_NAME");
  });

  it("fails fast when Supabase Auth has only public configuration", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    expect(() => validateOptionalRuntimeEnvironment()).toThrow("SUPABASE_SECRET_KEY");
  });

  it("fails fast when AI Gateway is enabled without account and gateway IDs", () => {
    process.env.CLOUDFLARE_AI_GATEWAY_ENABLED = "true";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    expect(() => validateOptionalRuntimeEnvironment()).toThrow("CLOUDFLARE_AI_GATEWAY_ID");
  });

  it("accepts centrally constructed provider-native settings", () => {
    process.env.CLOUDFLARE_AI_GATEWAY_ENABLED = "true";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    process.env.CLOUDFLARE_AI_GATEWAY_ID = "gateway";
    expect(() => validateOptionalRuntimeEnvironment()).not.toThrow();
  });

  it("fails closed when WhatsApp is enabled without Meta credentials", () => {
    process.env.WHATSAPP_INTEGRATION_ENABLED = "true";
    expect(() => validateOptionalRuntimeEnvironment()).toThrow("META_APP_ID");
  });

  it("accepts a complete WhatsApp Cloud API configuration", () => {
    Object.assign(process.env, {
      WHATSAPP_INTEGRATION_ENABLED: "true",
      META_APP_ID: "123456",
      META_APP_SECRET: "0123456789abcdef0123456789abcdef",
      META_GRAPH_API_VERSION: "v23.0",
      WHATSAPP_ACCESS_TOKEN: "test-access-token-that-is-long-enough",
      WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      WHATSAPP_BUSINESS_ACCOUNT_ID: "9876543210",
      WHATSAPP_DISPLAY_PHONE_NUMBER: "967700000000",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token-123456",
      WHATSAPP_CONNECT_TOKEN_SECRET: "connect-token-secret-32-characters-minimum",
      WHATSAPP_CONNECT_TOKEN_TTL_MINUTES: "10",
      PUBLIC_APP_URL: "https://app.example",
    });
    expect(() => validateOptionalRuntimeEnvironment()).not.toThrow();
  });

  it("requires the explicit provider fallback policy before direct gateway fallback", () => {
    process.env.AI_PROVIDER_DIRECT_FALLBACK_ENABLED = "true";
    expect(() => validateOptionalRuntimeEnvironment()).toThrow("AI_PROVIDER_FALLBACK_ENABLED");
  });
});
