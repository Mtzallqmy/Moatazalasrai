import { describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/lib/security/encryption";

const mocks = vi.hoisted(() => ({
  integration: {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    kind: "telegram" as const,
    enabled: true,
    status: "verified",
    config: { webhookSecretHash: "" },
    encryptedToken: "not-used",
  },
  denied: vi.fn(async () => undefined),
  enforceRateLimit: vi.fn(async () => undefined),
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [mocks.integration],
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/security/audit", () => ({ recordDeniedAccess: mocks.denied }));
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  requestClientKey: () => "test-client",
}));
vi.mock("@/lib/agents/runtime", () => ({ executeAgentRun: vi.fn() }));
vi.mock("@/lib/integrations/github", () => ({ listGitHubRepositories: vi.fn(), readGitHubFile: vi.fn() }));
vi.mock("@/lib/integrations/telegram", () => ({
  downloadTelegramFile: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));
vi.mock("@/lib/storage/attachments", () => ({
  attachmentContext: vi.fn(),
  storeAttachment: vi.fn(),
  waitForAttachmentReady: vi.fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));

describe("Telegram webhook authentication", () => {
  it("rejects a forged secret before reading JSON", async () => {
    mocks.integration.config.webhookSecretHash = hashApiKey("expected-telegram-secret");
    mocks.denied.mockClear();
    mocks.enforceRateLimit.mockClear();
    const request = new Request(
      "https://app.example/api/webhooks/telegram/11111111-1111-4111-8111-111111111111",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "forged-secret",
        },
        body: "not-valid-json",
      },
    );
    const jsonSpy = vi.spyOn(request, "json");
    const { POST } = await import("@/app/api/webhooks/telegram/[integrationId]/route");
    const response = await POST(request, {
      params: Promise.resolve({ integrationId: mocks.integration.id }),
    });
    expect(response.status).toBe(401);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.denied).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: mocks.integration.organizationId,
      reason: "TELEGRAM_SECRET_INVALID",
    }));
  });
});
