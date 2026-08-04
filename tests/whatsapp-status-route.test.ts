import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ currentSession: mocks.currentSession }));
vi.mock("@/lib/integrations/whatsapp/linking", () => ({ whatsappConnectionStatus: mocks.status }));

afterEach(() => {
  delete process.env.WHATSAPP_INTEGRATION_ENABLED;
  mocks.currentSession.mockReset();
  mocks.status.mockReset();
});

describe("WhatsApp status endpoint", () => {
  it("fails closed through the feature flag without querying connection data", async () => {
    mocks.currentSession.mockResolvedValue({
      sessionId: "session",
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "member",
    });
    process.env.WHATSAPP_INTEGRATION_ENABLED = "false";
    const { GET } = await import("@/app/api/integrations/whatsapp/status/route");
    const response = await GET(new Request("https://app.example/api/integrations/whatsapp/status"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      enabled: false,
      connected: false,
      connectedAt: null,
      phoneNumberMasked: null,
    });
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
