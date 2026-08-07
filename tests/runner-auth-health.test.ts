import { afterEach, describe, expect, it, vi } from "vitest";
import { probeAuthenticatedRunner } from "@/lib/platform/runner-auth-health";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticated runner health", () => {
  it("requires the signed probe to pass before accepting Sandbox /health", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/moataz-auth-health-probe")) {
        return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, activeExecutions: 0 }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const result = await probeAuthenticatedRunner({
      feature: "sandbox",
      runnerUrl: "https://sandbox.example.test",
      sharedSecret: "a".repeat(32),
    });

    expect(result.status).toBe("healthy");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://sandbox.example.test/v1/moataz-auth-health-probe");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("x-moataz-timestamp")).toMatch(/^\d+$/);
    expect(headers.get("x-moataz-nonce")).toBeTruthy();
    expect(headers.get("x-moataz-signature")).toBeTruthy();
    expect(calls[1]?.url).toBe("https://sandbox.example.test/health");
  });

  it("reports a wrong Browser shared secret as unauthorized without trusting public health", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeAuthenticatedRunner({
      feature: "browser",
      runnerUrl: "https://browser.example.test",
      sharedSecret: "wrong-secret-that-is-long-enough-123456",
    });

    expect(result.status).toBe("unauthorized");
    expect(result.details).toContain("السر المشترك");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
