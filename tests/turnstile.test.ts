import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/security/turnstile";

const now = Date.parse("2026-08-02T12:00:00.000Z");

beforeEach(() => {
  process.env.TURNSTILE_ENABLED = "true";
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.TURNSTILE_EXPECTED_HOSTNAME = "app.example.com";
  process.env.TRUST_CLOUDFLARE_PROXY = "true";
});

afterEach(() => {
  delete process.env.TURNSTILE_ENABLED;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_EXPECTED_HOSTNAME;
  delete process.env.TRUST_CLOUDFLARE_PROXY;
});

function request() {
  return new Request("https://app.example.com/api/auth/login", { headers: { "cf-connecting-ip": "192.0.2.9" } });
}

function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: true, hostname: "app.example.com", action: "login", challenge_ts: new Date(now - 1_000).toISOString(), ...overrides }), { status: 200 });
}

describe("Cloudflare Turnstile server verification", () => {
  it("validates hostname, action, age and consumes the token once", async () => {
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      expect(args[0]).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      return response();
    });
    const consumeToken = vi.fn(async () => true);
    await expect(verifyTurnstile({ request: request(), token: "valid-token", expectedAction: "login", fetchImpl: fetchImpl as typeof fetch, consumeToken, now: () => now })).resolves.toMatchObject({ enabled: true });
    expect(consumeToken).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), "login");
    const sent = fetchImpl.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(sent.get("remoteip")).toBe("192.0.2.9");
  });

  it.each([
    [{ success: false }, "TURNSTILE_INVALID"],
    [{ hostname: "attacker.example" }, "TURNSTILE_INVALID"],
    [{ action: "register" }, "TURNSTILE_INVALID"],
    [{ challenge_ts: new Date(now - 6 * 60_000).toISOString() }, "TURNSTILE_INVALID"],
  ])("rejects invalid verification payload %#", async (overrides, code) => {
    await expect(verifyTurnstile({ request: request(), token: "invalid-token", expectedAction: "login", fetchImpl: (async () => response(overrides)) as typeof fetch, consumeToken: async () => true, now: () => now }))
      .rejects.toMatchObject({ code });
  });

  it("rejects replay even if an upstream response is successful", async () => {
    await expect(verifyTurnstile({ request: request(), token: "used-token", expectedAction: "login", fetchImpl: (async () => response()) as typeof fetch, consumeToken: async () => false, now: () => now }))
      .rejects.toMatchObject({ code: "TURNSTILE_REPLAYED", status: 409 });
  });

  it("is a no-op when the feature flag is disabled", async () => {
    process.env.TURNSTILE_ENABLED = "false";
    await expect(verifyTurnstile({ request: request(), expectedAction: "login", fetchImpl: vi.fn() as unknown as typeof fetch })).resolves.toEqual({ enabled: false });
  });
});
