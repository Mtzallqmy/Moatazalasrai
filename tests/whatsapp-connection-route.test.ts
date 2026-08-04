import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(),
  disconnect: vi.fn(),
  sendText: vi.fn(async () => ({ messageId: "wamid.confirm" })),
}));

vi.mock("@/lib/auth/session", () => ({ currentSession: mocks.currentSession }));
vi.mock("@/lib/integrations/whatsapp/config", () => ({ requireWhatsAppConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/integrations/whatsapp/linking", () => ({ disconnectWhatsAppForUser: mocks.disconnect }));
vi.mock("@/lib/integrations/whatsapp/client", () => ({ sendTextMessage: mocks.sendText }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));

afterEach(() => {
  mocks.currentSession.mockReset();
  mocks.disconnect.mockReset();
  mocks.sendText.mockClear();
});

describe("WhatsApp disconnect endpoint", () => {
  it("disconnects the session user, sends best-effort confirmation, and never exposes wa_id", async () => {
    mocks.currentSession.mockResolvedValue({
      sessionId: "session",
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "member",
    });
    mocks.disconnect.mockResolvedValue({ disconnected: true, waId: "967711111111" });
    const { DELETE } = await import("@/app/api/integrations/whatsapp/connection/route");
    const response = await DELETE(new Request("https://app.example/api/integrations/whatsapp/connection", {
      method: "DELETE",
      headers: { origin: "https://app.example", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.disconnect).toHaveBeenCalledWith(expect.objectContaining({
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
    }));
    expect(mocks.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: "967711111111" }));
    const payload = await response.json();
    expect(payload.data).toEqual({ disconnected: true, changed: true });
    expect(JSON.stringify(payload)).not.toContain("967711111111");
  });
});
