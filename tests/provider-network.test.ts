import { describe, expect, it } from "vitest";
import { isPublicIp, validateProviderBaseUrl } from "@/lib/security/provider-network";

describe("provider network safety", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
  ])("blocks private or metadata address %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it("accepts globally routable addresses", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects credentials embedded in URLs", async () => {
    await expect(validateProviderBaseUrl("https://user:password@8.8.8.8/v1")).rejects.toMatchObject({
      code: "URL_CREDENTIALS_FORBIDDEN",
    });
  });

  it("rejects literal private provider targets", async () => {
    await expect(validateProviderBaseUrl("https://127.0.0.1/v1")).rejects.toMatchObject({
      code: "PRIVATE_ADDRESS_FORBIDDEN",
    });
  });
});
