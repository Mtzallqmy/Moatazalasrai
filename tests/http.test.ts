import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NextRequest } from "next/server";
import { assertSameOrigin, getRequestId, parseJson } from "@/lib/http/api";
import { proxy } from "@/proxy";

describe("HTTP safety helpers", () => {
  it("does not trust malformed request IDs", () => {
    const request = new Request("https://app.example.com", { headers: { "x-request-id": "bad value" } });
    expect(getRequestId(request)).not.toBe("bad value");
  });

  it("rejects cross-origin cookie mutations", () => {
    const request = new Request("https://app.example.com/api/action", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(() => assertSameOrigin(request)).toThrow();
  });

  it("fails closed for a malformed Origin header", () => {
    const request = new Request("https://app.example.com/api/action", {
      method: "POST",
      headers: { origin: "not a valid origin" },
    });
    expect(() => assertSameOrigin(request)).toThrow(expect.objectContaining({ code: "CSRF_REJECTED" }));
  });

  it("enforces JSON body size and shape", async () => {
    const request = new Request("https://app.example.com/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJson(request, z.object({ value: z.literal("ok") }).strict())).resolves.toEqual({ value: "ok" });
  });

  it("issues a nonce-based CSP without unsafe inline scripts", () => {
    const response = proxy(new NextRequest("https://app.example.com/dashboard"));
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
