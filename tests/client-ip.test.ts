import { afterEach, describe, expect, it } from "vitest";
import { anonymizeIp, clientIp } from "@/lib/security/client-ip";

afterEach(() => {
  delete process.env.TRUST_CLOUDFLARE_PROXY;
  delete process.env.TRUST_PROXY_HEADERS;
});

describe("trusted client IP extraction", () => {
  it("ignores spoofed forwarding headers by default", () => {
    const request = new Request("https://app.example", { headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" } });
    expect(clientIp(request, "203.0.113.9")).toEqual({ address: "203.0.113.9", source: "runtime" });
  });

  it("accepts Cloudflare's canonical header only behind the configured proxy", () => {
    process.env.TRUST_CLOUDFLARE_PROXY = "true";
    const request = new Request("https://app.example", { headers: { "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "2.2.2.2" } });
    expect(clientIp(request)).toEqual({ address: "2001:db8:0:0:0:0:0:1", source: "cloudflare" });
  });

  it("skips malformed forwarded values and normalizes mapped IPv4", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    const request = new Request("https://app.example", { headers: { "x-forwarded-for": "invalid, ::ffff:192.0.2.8" } });
    expect(clientIp(request)).toEqual({ address: "192.0.2.8", source: "forwarded" });
  });

  it("anonymizes addresses before session persistence", () => {
    expect(anonymizeIp("192.0.2.55")).toBe("192.0.2.0/24");
    expect(anonymizeIp("2001:db8::1234")).toBe("2001:db8:0:0::/64");
  });
});
