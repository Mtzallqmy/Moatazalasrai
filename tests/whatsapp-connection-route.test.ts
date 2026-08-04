import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  disconnect: vi.fn(),
  sendText: vi.fn(async () => ({ messageId: "wamid.confirm" })),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/integrations/whatsapp/config", () => ({ requireWhatsAppConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/integrations/whatsapp/linking", () => ({ disconnectWhatsAppForUser: mocks.disconnect }));
vi.mock("@/lib/integrations/whatsapp/client", () => ({ sendTextMessage: mocks.sendText }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => undefined) }));

afterEach(() => {
  mocks.requireSession.mockReset();
  mocks.disconnect.mockReset();
  mocks.sendText.mockClear();
});

function sameOriginRequest(path: string, method: string) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const origin = new URL(appUrl).origin;
  return new Request(new URL(path, `${origin}/`), {
    method,
    headers: { origin, "sec-fetch-site": "same-origin" },
  });
}

describe("WhatsApp disconnect endpoint", () => {
  it("disconnects the session user, sends best-effort confirmation, and never exposes wa_id", async () => {
    mocks.requireSession.mockResolvedValue({
      sessionId: "session",
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "member",
    });
    mocks.disconnect.mockResolvedValue({ disconnected: true, waId: "967711111111" });
    const { DELETE } = await import("@/app/api/integrations/whatsapp/connection/route");
    const response = await DELETE(sameOriginRequest("/api/integrations/whatsapp/connection", "DELETE"));
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
