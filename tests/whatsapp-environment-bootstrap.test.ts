import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WHATSAPP_ENVIRONMENT_NAMES,
  classifyMetaGraphError,
  inspectWhatsAppEnvironment,
  testMetaGraphApi,
  type WhatsAppEnvironmentConfig,
} from "@/lib/platform/whatsapp-environment";

const extraKeys = [
  "WHATSAPP_INTEGRATION_ENABLED",
  "RAILWAY_ENVIRONMENT_NAME",
  "PHONE_NUMBER_ID",
] as const;

function completeEnvironment() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    META_APP_ID: "123456789",
    META_APP_SECRET: "0123456789abcdef0123456789abcdef",
    META_GRAPH_API_VERSION: "v23.0",
    WHATSAPP_ACCESS_TOKEN: "test-access-token-that-is-long-enough",
    WHATSAPP_PHONE_NUMBER_ID: "111111111111111",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "222222222222222",
    WHATSAPP_DISPLAY_PHONE_NUMBER: "+967 700 000 000",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token-123456",
    WHATSAPP_CONNECT_TOKEN_SECRET: "connect-token-secret-32-characters-minimum",
    APP_URL: "https://app.example",
    PUBLIC_APP_URL: "https://app.example",
    RAILWAY_ENVIRONMENT_NAME: "production",
  });
}

afterEach(() => {
  for (const key of [...WHATSAPP_ENVIRONMENT_NAMES, ...extraKeys]) delete process.env[key];
  vi.restoreAllMocks();
});

describe("WhatsApp Railway environment bootstrap", () => {
  it("treats the listed variables as authoritative without a manual feature flag", () => {
    completeEnvironment();
    const inspection = inspectWhatsAppEnvironment();
    expect(inspection).toMatchObject({
      authoritative: true,
      complete: true,
      valid: true,
      loadedCount: WHATSAPP_ENVIRONMENT_NAMES.length,
      railwayEnvironment: "production",
    });
    expect(inspection.config?.displayPhoneNumber).toBe("967700000000");
    expect(inspection.variables.find((item) => item.name === "WHATSAPP_ACCESS_TOKEN")?.displayValue)
      .not.toBe(process.env.WHATSAPP_ACCESS_TOKEN);
    expect(process.env.WHATSAPP_INTEGRATION_ENABLED).toBeUndefined();
  });

  it("diagnoses missing canonical names and reports a common alias", () => {
    process.env.PHONE_NUMBER_ID = "111111111111111";
    process.env.META_APP_ID = "123456789";
    const inspection = inspectWhatsAppEnvironment();
    expect(inspection.authoritative).toBe(true);
    expect(inspection.valid).toBe(false);
    expect(inspection.missing).toContain("WHATSAPP_PHONE_NUMBER_ID");
    expect(inspection.variables.find((item) => item.name === "WHATSAPP_PHONE_NUMBER_ID")?.aliasFound)
      .toBe("PHONE_NUMBER_ID");
  });

  it("classifies Meta token, permission, and phone ID failures", () => {
    expect(classifyMetaGraphError({ code: 190, message: "Invalid OAuth access token" }, 400).category)
      .toBe("invalid_token");
    expect(classifyMetaGraphError({ code: 200, message: "Missing whatsapp_business_messaging permission" }, 403).category)
      .toBe("missing_scope");
    expect(classifyMetaGraphError({ code: 100, error_subcode: 33, message: "Unsupported get request" }, 400).category)
      .toBe("wrong_phone_number_id");
  });

  it("verifies the phone object and WABA subscription through Graph API", async () => {
    completeEnvironment();
    const config = inspectWhatsAppEnvironment().config as WhatsAppEnvironmentConfig;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: config.phoneNumberId,
        display_phone_number: "+967 700 000 000",
        verified_name: "Moataz AI",
        quality_rating: "GREEN",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: config.appId, name: "Moataz AI" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const health = await testMetaGraphApi(config, fetchImpl);
    expect(health).toMatchObject({
      status: "healthy",
      category: "ok",
      phone: { id: config.phoneNumberId, verifiedName: "Moataz AI", qualityRating: "GREEN" },
      webhook: { subscriptionStatus: "subscribed", appIdFound: true, verifyTokenLoaded: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`/${config.graphApiVersion}/${config.phoneNumberId}`);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(`/${config.graphApiVersion}/${config.businessAccountId}/subscribed_apps`);
  });
});
