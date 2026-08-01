import { afterEach, describe, expect, it } from "vitest";
import { validateOptionalRuntimeEnvironment } from "../scripts/validate-runtime-env.mjs";

const keys = [
  "TURNSTILE_ENABLED", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_EXPECTED_HOSTNAME",
  "OBJECT_STORAGE_DRIVER", "R2_ACCOUNT_ID", "R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_AI_GATEWAY_ENABLED", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_GATEWAY_ID", "CLOUDFLARE_API_TOKEN", "OPENAI_BASE_URL",
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

  it("fails fast when AI Gateway is enabled without its OpenAI URL", () => {
    process.env.CLOUDFLARE_AI_GATEWAY_ENABLED = "true";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    process.env.CLOUDFLARE_AI_GATEWAY_ID = "gateway";
    expect(() => validateOptionalRuntimeEnvironment()).toThrow("OPENAI_BASE_URL");
  });

  it("accepts complete AI Gateway settings without requiring an auth token", () => {
    process.env.CLOUDFLARE_AI_GATEWAY_ENABLED = "true";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    process.env.CLOUDFLARE_AI_GATEWAY_ID = "gateway";
    process.env.OPENAI_BASE_URL = "https://gateway.ai.cloudflare.com/v1/account/gateway/compat";
    expect(() => validateOptionalRuntimeEnvironment()).not.toThrow();
  });
});
