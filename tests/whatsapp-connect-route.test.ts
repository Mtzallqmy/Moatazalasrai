import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(),
  createLink: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ currentSession: mocks.currentSession }));
vi.mock("@/lib/integrations/whatsapp/linking", () => ({ createWhatsAppConnectLink: mocks.createLink }));
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  requestClientKey: vi.fn(() => "client"),
}));

afterEach(() => {
  mocks.currentSession.mockReset();
  mocks.createLink.mockReset();
});

describe("WhatsApp connect endpoint", () => {
  it("rejects an unauthenticated user", async () => {
    mocks.currentSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/integrations/whatsapp/connect/route");
    const response = await POST(new Request("https://app.example/api/integrations/whatsapp/connect", {
      method: "POST",
      headers: { origin: "https://app.example", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(401);
    expect(mocks.createLink).not.toHaveBeenCalled();
  });

  it("uses the authenticated session identity and returns only URL and expiry", async () => {
    mocks.currentSession.mockResolvedValue({
      sessionId: "session", userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002", role: "member",
    });
    mocks.createLink.mockResolvedValue({
      whatsappUrl: "https://wa.me/967700000000?text=CONNECT%20opaque",
      expiresAt: new Date("2026-08-03T20:00:00.000Z"),
    });
    const { POST } = await import("@/app/api/integrations/whatsapp/connect/route");
    const response = await POST(new Request("https://app.example/api/integrations/whatsapp/connect", {
      method: "POST",
      headers: { origin: "https://app.example", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(201);
    expect(mocks.createLink).toHaveBeenCalledWith(expect.objectContaining({
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
    }));
    const payload = await response.json();
    expect(payload.data).toEqual({
      whatsappUrl: "https://wa.me/967700000000?text=CONNECT%20opaque",
      expiresAt: "2026-08-03T20:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("userId");
    expect(JSON.stringify(payload)).not.toContain("accessToken");
  });
});
